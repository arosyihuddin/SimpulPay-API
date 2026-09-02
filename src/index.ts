import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { v1Routes } from "./routes/v1";
import { customerRoutes } from "./routes/customer";
import {
  cleanOldClaims,
  cleanExpiredSessions,
  markTransactionsExpired,
  insertLog,
  listAllMerchants,
  insertNotification,
  listExpiredSubscriptions,
  listInvoices,
  createInvoice,
  getPlan,
  listStalePendingSubscriptions,
  updateSubscription,
} from "./db/repositories";
import {
  loadSession,
  isExpired,
  refreshSession,
} from "./services/sessionManager";
import { createDb, closeDb } from "./db/client";
import { maintenanceGuard } from "./middleware/guards";
import { processWebhookQueue } from "./services/webhook";
import type { AppEnv, Env } from "./types";
import { AppHub } from "./durable_objects/appHub";

const app = new OpenAPIHono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("db", null);
  try {
    await next();
  } finally {
    await closeDb(c);
  }
});

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = (c.env.CORS_ORIGINS ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (allowed.length === 0) return origin;
      return origin && allowed.includes(origin) ? origin : null;
    },
    credentials: true,
  }),
);

app.use("*", maintenanceGuard);

app.route("/", publicRoutes);
app.route("/", customerRoutes);
app.route("/api/v1", v1Routes);
app.route("/admin", adminRoutes);

app.doc("/docs/json", {
  openapi: "3.0.3",
  info: {
    title: "GoMerch API",
    version: "1.0.0",
    description:
      "Payment Gateway & QRIS Verification — GoPay/GoBiz. Generate QRIS dinamis EMVCo, verifikasi pembayaran via API Gojek merchant, anti double-claim.\n\nFlow: `POST /api/v1/qris` → dapatkan `qris_code` → client render QR → verifikasi pembayaran otomatis dari backend.",
  },
  servers: [{ url: "/" }],
  security: [{ ApiKey: [] }],
});
app.openAPIRegistry.registerComponent("securitySchemes", "ApiKey", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
});
app.get("*", (c) => c.json({ success: false, message: "Not Found" }, 404));

app.onError((err, c) => {
  const status = (err as any).status || 500;
  const body: any = { success: false, message: err.message };
  const extra = (err as any).extra;
  if (extra) Object.assign(body, extra);
  return c.json(body, status);
});

export { AppHub };

export default {
  fetch: app.fetch,

  async scheduled(event: { cron: string }, env: Env, _ctx: ExecutionContext) {
    const { db: DB, client: DBClient } = createDb(env);
    if (event.cron === "0 * * * *") {
      try {
        await cleanOldClaims(DB);
        await cleanExpiredSessions(DB);
        // expired per merchant
        const merchants = await listAllMerchants(DB);
        for (const m of merchants) await markTransactionsExpired(DB, Date.now(), m.id);
        // pending sub >24 jam belum bayar → cancel
        const stale = await listStalePendingSubscriptions(DB, Date.now() - 24 * 60 * 60 * 1000);
        for (const s of stale) {
          await updateSubscription(DB, s.id, { status: "cancelled" });
          await insertLog(DB, "INFO", `Stale pending sub ${s.id} dibatalkan (24h)`, null, s.user_id);
        }
        // sub aktif yg ends_at lewat → expired + bikin invoice perpanjangan
        const expired = await listExpiredSubscriptions(DB);
        for (const s of expired) {
          const now = Date.now();
          // Jangan duplikat invoice kalo udah ada yg pending utk sub ini
          const existing = await listInvoices(DB, {
            subscriptionId: s.id,
            status: "pending",
          });
          await updateSubscription(DB, s.id, { status: "expired" });
          await insertLog(
            DB,
            "INFO",
            `Sub ${s.id} expired (ends_at lewat); user ${s.user_id} turun ke free`,
            null,
            s.user_id,
          );
          if (existing.length > 0) continue;
          const plan = await getPlan(DB, s.plan_id);
          await createInvoice(DB, {
            id: "inv_" + crypto.randomUUID().slice(0, 8),
            userId: s.user_id,
            subscriptionId: s.id,
            amount: plan?.price ?? 0,
            periodStart: now,
            periodEnd: now + 30 * 24 * 60 * 60 * 1000,
          });
        }
      } catch (err) {
        console.error("[cron] Gagal cleanup:", (err as Error).message);
      }
    } else if (event.cron === "* * * * *") {
      // retry webhook queue
      try {
        await processWebhookQueue(DB);
      } catch (err) {
        console.error("[cron] Gagal process webhook queue:", (err as Error).message);
      }
      // Safety net: pancing DO pooling kalo alarm chain mati (mis. DO restart).
      // Harmless — DO sendiri yg jadwalin alarm berikutnya kalo masih ada pending.
      try {
        const stub = env.APP_HUB.get(env.APP_HUB.idFromName("global"));
        await stub.fetch("http://internal/start-pooling");
      } catch (err) {
        console.error("[cron] Gagal pancing DO pooling:", (err as Error).message);
      }
    } else if (event.cron === "0 */6 * * *") {
      // auto-refresh sesi per merchant
      const merchants = await listAllMerchants(DB);
      for (const m of merchants) {
        try {
          const session = await loadSession(DB, m.id);
          if (session && session.refresh_token && isExpired(session)) {
            await insertLog(
              DB,
              "INFO",
              `Auto Refresh: Token merchant ${m.id} mendekati kedaluwarsa, memperbarui sesi...`,
            );
            const refreshed = await refreshSession(DB, m.id);
            if (!refreshed) {
              await insertNotification(DB, {
                userId: m.user_id,
                merchantId: m.id,
                type: "token_warning",
                title: "Sesi GoBiz Perlu Login Ulang",
                message: `Auto-refresh token gagal untuk merchant ${m.name}. Login OTP ulang di dashboard.`,
              });
            }
          }
        } catch (err) {
          await insertLog(
            DB,
            "ERROR",
            `Gagal auto refresh session merchant ${m.id}: ${(err as Error).message}`,
          );
        }
      }
    }
    await DBClient.end().catch(() => {});
  },
};
