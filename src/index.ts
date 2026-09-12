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
import type { ContentfulStatusCode } from "hono/utils/http-status";
function errDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : "unknown error";
  if (err !== null && typeof err === "object" && "cause" in err) {
    const cause = err.cause;
    if (cause !== null && typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
      return `${msg} | cause: ${cause.message}`;
    }
  }
  return msg;
}

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
  let code: ContentfulStatusCode = 500;
  let appError = false;
  if (err !== null && typeof err === "object" && "status" in err && typeof err.status === "number") {
    appError = true;
    switch (err.status) {
      case 400:
        code = 400;
        break;
      case 401:
        code = 401;
        break;
      case 403:
        code = 403;
        break;
      case 404:
        code = 404;
        break;
      case 410:
        code = 410;
        break;
      case 503:
        code = 503;
        break;
      default:
        code = 500;
        break;
    }
  }
  const body: Record<string, unknown> = {
    success: false,
    message: appError && err instanceof Error ? err.message : "Terjadi kesalahan internal",
  };
  if (appError && err !== null && typeof err === "object" && "extra" in err) {
    if (err.extra !== null && typeof err.extra === "object") Object.assign(body, err.extra);
  }
  let detail = err instanceof Error ? err.message : "unknown error";
  if (err !== null && typeof err === "object" && "cause" in err) {
    const cause = err.cause;
    if (cause !== null && typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
      detail += ` | cause: ${cause.message}`;
    }
    if (cause !== null && typeof cause === "object" && "code" in cause && typeof cause.code === "string") {
      detail += ` | code: ${cause.code}`;
    }
  }
  logger.error(`[fetch] ${detail}`);
  return c.json(body, code);
});

export { AppHub, SubTimer };

export default {
  fetch: app.fetch,

  async scheduled(event: { cron: string }, env: Env, _ctx: ExecutionContext) {
    const { db: DB } = createDb(env);
    if (event.cron === "* * * * *") {
      // Pengganti cron hourly: sapu klaim >24 jam tiap tick (murah, no-op bila kosong).
      try {
        await cleanOldClaims(DB);
      } catch (err) {
        logger.error(`[cron] Gagal cleanup klaim: ${errDetail(err)}`);
      }
      // retry webhook queue
      try {
        await processWebhookQueue(DB);
      } catch (err) {
        logger.error(`[cron] Gagal process webhook queue: ${errDetail(err)}`);
      }
      try {
        const stub = env.APP_HUB.get(env.APP_HUB.idFromName("global"));
        await stub.fetch("http://internal/start-pooling");
      } catch (err) {
        logger.error(`[cron] Gagal pancing DO pooling: ${errDetail(err)}`);
      }
    }
  },
};
