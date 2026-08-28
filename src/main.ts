// Elysia entrypoint — gabung route publik + admin, cron interval, error handler
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { v1Routes } from "./routes/v1";
import {
  cleanOldClaims,
  cleanExpiredSessions,
  markQRISExpired,
  insertLog,
} from "./db/queries";
import { ensureSchema } from "./db/client";
import {
  loadSession,
  isExpired,
  refreshSession,
} from "./services/sessionManager";
import { onSubscribe, onUnsubscribe } from "./services/realtime";

const PORT = Number(process.env.PORT || 3000);

// Cleanup klaim & sesi admin & QRIS kadaluwarsa (tiap 1 jam)
setInterval(
  () => {
    try {
      cleanOldClaims();
      cleanExpiredSessions();
      markQRISExpired();
    } catch (err) {
      console.error("[cron] Gagal cleanup:", (err as Error).message);
    }
  },
  60 * 60 * 1000,
);

// Auto-refresh sesi GoBiz tiap 6 jam bila mendekati kedaluwarsa
setInterval(
  async () => {
    try {
      const session = await loadSession();
      if (session && session.refresh_token && isExpired(session)) {
        await insertLog(
          "INFO",
          "Auto Refresh: Token mendekati kedaluwarsa, memperbarui sesi...",
        );
        await refreshSession();
      }
    } catch (err) {
      await insertLog(
        "ERROR",
        `Gagal auto refresh session: ${(err as Error).message}`,
      );
    }
  },
  6 * 60 * 60 * 1000,
);

// Bootstrap: pastikan tabel postgres ada SEBELUM server mulai terima request.
// (sqlite bikin tabel otomatis di client.ts; postgres sekarang menyusul.)
await ensureSchema();

// CORS — deploy terpisah: frontend di host lain harus di-allowlist + credentials.
// CORS_ORIGIN: daftar origin dipisah koma (contoh https://admin.gomerch.com,https://gomerch.com)
// Kosong => allow semua (mode dev, non-credential).
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

new Elysia()
  .use(
    cors({
      origin: corsOrigins.length > 0 ? corsOrigins : true,
      credentials: corsOrigins.length > 0,
    }),
  )
  .use(
    swagger({
      path: "/docs",
      exclude: [
        /^\/admin/,
        /^\/qr$/,
        /^\/qr\//,
        /^\/api\/qr-status/,
        /^\/health$/,
        /^\/api\/health$/,
        /^\/*$/,
      ],
      documentation: {
        info: {
          title: "GoPay Merchant Gateway API",
          version: "1.0.0",
          description: "Public API untuk integrasi pembayaran QRIS GoPay",
        },
        tags: [
          { name: "System" },
          { name: "QRIS" },
          { name: "Payment" },
          { name: "Transactions" },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              description: "API key dikirim sebagai Bearer token",
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    }),
  )
  .use(publicRoutes)
  .use(v1Routes)
  .use(adminRoutes)
  .ws("/ws", {
    open(ws) {
      const scope = ws.data.query?.scope as string | undefined;
      onSubscribe(ws, scope);
    },
    close(ws) {
      onUnsubscribe(ws);
    },
  })
  .get("/*", () => {
    const err: any = new Error("Not Found");
    err.status = 404;
    throw err;
  })
  .onError(({ error, set }) => {
    const status = (error as any).status || 500;
    set.status = status;
    const body: any = { success: false, message: (error as Error).message };
    const extra = (error as any).extra;
    if (extra) Object.assign(body, extra);
    return body;
  })
  .listen(PORT, () => {
    console.log(`🦊 GoPay Partner Gateway berjalan pada port ${PORT}`);
  });
