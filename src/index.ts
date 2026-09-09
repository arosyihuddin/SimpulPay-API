import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { v1Routes } from "./routes/v1";
import { customerRoutes } from "./routes/customer";
import { createDb, closeDb } from "./db/client";
import { cleanOldClaims } from "./db/repositories";
import { processWebhookQueue } from "./services/webhook";
import { maintenanceGuard } from "./middleware/guards";
import type { AppEnv, Env } from "./types";
import { logger, setLogLevel } from "./utils/logger";
import { AppHub } from "./durable_objects/appHub";
import { SubTimer } from "./durable_objects/subTimer";

const app = new OpenAPIHono<AppEnv>();

app.use("*", async (c, next) => {
  setLogLevel(c.env.LOG_LEVEL);
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
    title: "SimpulPay",
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

export { AppHub, SubTimer };

export default {
  fetch: app.fetch,

  async scheduled(event: { cron: string }, env: Env, _ctx: ExecutionContext) {
    const { db: DB, client: DBClient } = createDb(env);
    if (event.cron === "* * * * *") {
      // Pengganti cron hourly: sapu klaim >24 jam tiap tick (murah, no-op bila kosong).
      try {
        await cleanOldClaims(DB);
      } catch (err) {
        logger.error(`[cron] Gagal cleanup klaim: ${(err as Error).message}`);
      }
      // retry webhook queue
      try {
        await processWebhookQueue(DB);
      } catch (err) {
        logger.error(
          `[cron] Gagal process webhook queue: ${(err as Error).message}`,
        );
      }
      try {
        const stub = env.APP_HUB.get(env.APP_HUB.idFromName("global"));
        await stub.fetch("http://internal/start-pooling");
      } catch (err) {
        logger.error(
          `[cron] Gagal pancing DO pooling: ${(err as Error).message}`,
        );
      }
    }
    await DBClient.end().catch(() => {});
  },
};
