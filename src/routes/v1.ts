import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { apiKeyGuard, merchantGuard } from "../middleware/guards";
import type { AppEnv } from "../types";
import {
  health,
  merchantStatus,
  createQris,
  getQris,
  checkPayment,
  listTransactions,
  monthTransactions,
  tokenStatus,
  logs,
} from "../controllers/v1.controller";
import {
  v1HealthRes,
  merchantStatusRes,
  createQrisReq,
  createQrisRes,
  getQrisRes,
  paymentCheckReq,
  paymentCheckRes,
  transactionsRes,
  tokenStatusRes,
  logsRes,
  errorRes,
} from "../types/openapi";

const v1Routes = new OpenAPIHono<AppEnv>();
v1Routes.use("*", apiKeyGuard);
// merchantGuard: semua route v1 butuh merchant_id (query/header)
v1Routes.use("*", merchantGuard);
// Response schema cuma untuk spec OpenAPI — handler controller longgar.
const reg: any = (route: any, handler: any) => v1Routes.openapi(route, handler);

reg(
  createRoute({
    method: "get",
    path: "/health",
    tags: ["API v1"],
    summary: "Cek API key & layanan",
    responses: { 200: { description: "OK", content: { "application/json": { schema: v1HealthRes } } } },
  }),
  health,
);

reg(
  createRoute({
    method: "get",
    path: "/merchant-status",
    tags: ["API v1"],
    summary: "Status merchant (sesi, token, QRIS static)",
    responses: { 200: { description: "Status merchant", content: { "application/json": { schema: merchantStatusRes } } } },
  }),
  merchantStatus,
);

reg(
  createRoute({
    method: "post",
    path: "/qris",
    tags: ["API v1"],
    summary: "Buat QRIS dinamis",
    request: { body: { content: { "application/json": { schema: createQrisReq } } } },
    responses: {
      200: { description: "QRIS dibuat", content: { "application/json": { schema: createQrisRes } } },
      400: { description: "Nominal tidak valid", content: { "application/json": { schema: errorRes } } },
      500: { description: "QRIS static belum dikonfigurasi", content: { "application/json": { schema: errorRes } } },
    },
  }),
  createQris,
);

reg(
  createRoute({
    method: "get",
    path: "/qris/{id}",
    tags: ["API v1"],
    summary: "Detail & status QRIS",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Detail QRIS", content: { "application/json": { schema: getQrisRes } } },
      404: { description: "QRIS tidak ditemukan", content: { "application/json": { schema: errorRes } } },
    },
  }),
  getQris,
);

reg(
  createRoute({
    method: "post",
    path: "/payment/check",
    tags: ["API v1"],
    summary: "Verifikasi pembayaran",
    description: "Body atau query param. `startTime` = ms epoch. `trx_id` untuk scope anti double-claim.",
    request: { body: { content: { "application/json": { schema: paymentCheckReq } } } },
    responses: {
      200: { description: "paid:true = lunas", content: { "application/json": { schema: paymentCheckRes } } },
      500: { description: "Gagal ambil data dari Gojek", content: { "application/json": { schema: errorRes } } },
    },
  }),
  checkPayment,
);

reg(
  createRoute({
    method: "get",
    path: "/transactions",
    tags: ["API v1"],
    summary: "List transaksi GoPay",
    responses: { 200: { description: "List transaksi", content: { "application/json": { schema: transactionsRes } } } },
  }),
  listTransactions,
);

reg(
  createRoute({
    method: "get",
    path: "/transactions/month",
    tags: ["API v1"],
    summary: "Transaksi bulan ini (rekap)",
    responses: { 200: { description: "Total & list", content: { "application/json": { schema: transactionsRes } } } },
  }),
  monthTransactions,
);

reg(
  createRoute({
    method: "get",
    path: "/token-status",
    tags: ["API v1"],
    summary: "Status sesi token GoPay",
    responses: { 200: { description: "valid / invalid", content: { "application/json": { schema: tokenStatusRes } } } },
  }),
  tokenStatus,
);

reg(
  createRoute({
    method: "get",
    path: "/logs",
    tags: ["API v1"],
    summary: "Log terbaru",
    responses: { 200: { description: "List log", content: { "application/json": { schema: logsRes } } } },
  }),
  logs,
);

export { v1Routes };
