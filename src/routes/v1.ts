// Route API v1: endpoint publik terstruktur + Swagger docs (handler di controller)
import { Elysia, t } from "elysia";
import { extractApiKey, apiKeyOk } from "../middleware/guards";
import { fail } from "../middleware/errorHandler";
import {
  health,
  createQris,
  getQris,
  checkPayment,
  listTransactions,
  monthTransactions,
  tokenStatus,
  logs,
} from "../controllers/v1.controller";

export const v1Routes = new Elysia({ prefix: "/api/v1" }).guard({}, (app) =>
  app
    .derive(({ headers, query }) => {
      const key = extractApiKey({
        headers: headers as any,
        query: query as any,
      });
      if (!apiKeyOk(key)) fail(401, "Autentikasi Gagal: API Key tidak valid");
    })
    .get("/health", health, {
      detail: {
        summary: "Health Check",
        tags: ["System"],
        description: "Cek status layanan API",
      },
    })
    .post("/qris", async ({ body }) => createQris(body), {
      detail: {
        summary: "Buat QRIS Dinamis",
        tags: ["QRIS"],
        description: "Buat QRIS pembayaran dinamis dengan nominal tertentu",
      },
      body: t.Object({ amount: t.Number({ minimum: 1 }) }),
    })
    .get("/qris/:id", async ({ params }) => getQris(params.id), {
      detail: {
        summary: "Cek QRIS",
        tags: ["QRIS"],
        description: "Cek status dan detail QRIS berdasarkan ID",
      },
    })
    .post("/payment/check", async ({ body, headers, query }) =>
      checkPayment(body, headers, query),
      {
        detail: {
          summary: "Verifikasi Pembayaran",
          tags: ["Payment"],
          description:
            "Cek apakah pembayaran dengan nominal tertentu sudah masuk dan lunas",
        },
        body: t.Object({
          amount: t.Number({ minimum: 1 }),
          trx_id: t.Optional(t.String()),
          startTime: t.Optional(t.Number()),
        }),
      },
    )
    .get("/transactions", async ({ query, headers }) =>
      listTransactions(query, headers),
      {
        detail: {
          summary: "Riwayat Transaksi",
          tags: ["Transactions"],
          description: "Ambil riwayat transaksi dari GoPay API",
        },
      },
    )
    .get("/transactions/month", async ({ query, headers }) =>
      monthTransactions(query, headers),
      {
        detail: {
          summary: "Transaksi Bulan Ini",
          tags: ["Transactions"],
          description: "Ambil semua transaksi bulan berjalan",
        },
      },
    )
    .get("/token-status", async ({ headers }) => tokenStatus(headers), {
      detail: {
        summary: "Status Token",
        tags: ["System"],
        description: "Cek status sesi GoPay/GoBiz masih aktif",
      },
    })
    .get("/logs", () => logs(), {
      detail: {
        summary: "Log Aktivitas",
        tags: ["System"],
        description: "Ambil log aktivitas sistem terbaru",
      },
    }),
);