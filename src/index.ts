import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { v1Routes } from "./routes/v1";
import { cleanOldClaims, cleanExpiredSessions, markQRISExpired, insertLog } from "./db/queries";
import { loadSession, isExpired, refreshSession } from "./services/sessionManager";
import { createDb, closeDb } from "./db/client";
import type { AppEnv, Env } from "./types";
import { MerchantWS } from "./durable_objects/merchantWS";

const app = new OpenAPIHono<AppEnv>();

app.use("*", async (c, next) => {
  // Lifecycle DB per-request: create di context, tutup di finally — termasuk
  // jalur ERROR (kalau handler lempar, client tak boleh bocor ke request
  // berikutnya; pending write-nya akan nulis ke konteks request beda).
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
    origin: ["https://gomerch-client.pages.dev", "http://localhost:5173"],
    credentials: true,
  }),
);

app.route("/", publicRoutes);
app.route("/api/v1", v1Routes);
app.route("/admin", adminRoutes);

app.doc("/docs/json", {
  openapi: "3.0.3",
  info: {
    title: "GoMerch API",
    version: "1.0.0",
    description:
      "Payment Gateway & QRIS Verification — GoPay/GoBiz. Generate QRIS dinamis EMVCo, verifikasi pembayaran via API Gojek merchant, anti double-claim.\n\nFlow: `POST /api/v1/qris` → customer bayar `amount_to_pay` → poll `GET /api/qr-status/:id` sampai `PAID`.",
  },
  servers: [{ url: "/" }],
  security: [{ ApiKey: [] }],
});
app.openAPIRegistry.registerComponent("securitySchemes", "ApiKey", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
});
app.get("/swagger", swaggerUI({ url: "/docs/json" }));

app.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }
  const scope = c.req.query("scope") ?? "admin";
  const stub = c.env.MERCHANT_WS.get(c.env.MERCHANT_WS.idFromName("global"));
  const url = new URL("http://internal");
  url.searchParams.set("scope", scope);
  return stub.fetch(new Request(url.toString(), { headers: { Upgrade: "websocket" } }));
});

app.get("*", (c) => c.json({ success: false, message: "Not Found" }, 404));

app.onError((err, c) => {
  const status = (err as any).status || 500;
  const body: any = { success: false, message: err.message };
  const extra = (err as any).extra;
  if (extra) Object.assign(body, extra);
  return c.json(body, status);
});

export { MerchantWS };

export default {
  fetch: app.fetch,

  async scheduled(event: { cron: string }, env: Env, _ctx: ExecutionContext) {
    const { db: DB, client: DBClient } = createDb(env);
    if (event.cron === "0 * * * *") {
      try {
        await cleanOldClaims(DB);
        await cleanExpiredSessions(DB);
        await markQRISExpired(DB);
      } catch (err) {
        console.error("[cron] Gagal cleanup:", (err as Error).message);
      }
    } else if (event.cron === "0 */6 * * *") {
      try {
        const session = await loadSession(DB);
        if (session && session.refresh_token && isExpired(session)) {
          await insertLog(DB, "INFO", "Auto Refresh: Token mendekati kedaluwarsa, memperbarui sesi...");
          await refreshSession(DB);
        }
      } catch (err) {
        await insertLog(DB, "ERROR", `Gagal auto refresh session: ${(err as Error).message}`);
      }
    }
    await DBClient.end().catch(() => {});
  },
};