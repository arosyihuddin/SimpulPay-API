import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { apiKeyGuard } from "../middleware/guards";
import type { AppEnv } from "../types";
import {
  health,
  createQris,
  getQris,
  checkPayment,
} from "../controllers/v1.controller";
import {
  createSandboxQris,
  simulateSandboxPay,
  simulateSandboxExpire,
} from "../controllers/sandbox.controller";
import {
  v1HealthRes,
  createQrisReq,
  createQrisRes,
  createSandboxRes,
  simulatePayRes,
  simulateExpireRes,
  getQrisRes,
  paymentCheckReq,
  paymentCheckRes,
  errorRes,
} from "../types/openapi";

const v1Routes = new OpenAPIHono<AppEnv>();
v1Routes.use("*", apiKeyGuard);
const reg: any = (route: any, handler: any) => v1Routes.openapi(route, handler);

reg(
  createRoute({
    method: "get",
    path: "/health",
    tags: ["System"],
    summary: "Cek API key & layanan",
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: v1HealthRes } },
      },
    },
  }),
  health,
);

reg(
  createRoute({
    method: "post",
    path: "/qris",
    tags: ["QRIS"],
    summary: "Buat QRIS dinamis",
    request: {
      body: { content: { "application/json": { schema: createQrisReq } } },
    },
    responses: {
      200: {
        description: "QRIS dibuat",
        content: { "application/json": { schema: createQrisRes } },
      },
      400: {
        description: "Nominal tidak valid",
        content: { "application/json": { schema: errorRes } },
      },
      500: {
        description: "QRIS static belum dikonfigurasi",
        content: { "application/json": { schema: errorRes } },
      },
    },
  }),
  createQris,
);

reg(
  createRoute({
    method: "get",
    path: "/qris/{id}",
    tags: ["QRIS"],
    summary: "Detail & status QRIS",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Detail QRIS",
        content: { "application/json": { schema: getQrisRes } },
      },
      404: {
        description: "QRIS tidak ditemukan",
        content: { "application/json": { schema: errorRes } },
      },
    },
  }),
  getQris,
);

reg(
  createRoute({
    method: "post",
    path: "/payment/check",
    tags: ["Payment"],
    summary: "Verifikasi pembayaran",
    description:
      "Body atau query param. `startTime` = ms epoch. `trx_id` untuk scope anti double-claim.",
    request: {
      body: { content: { "application/json": { schema: paymentCheckReq } } },
    },
    responses: {
      200: {
        description: "paid:true = lunas",
        content: { "application/json": { schema: paymentCheckRes } },
      },
      500: {
        description: "Gagal ambil data dari Gojek",
        content: { "application/json": { schema: errorRes } },
      },
    },
  }),
  checkPayment,
);
reg(
  createRoute({
    method: "post",
    path: "/sandbox/qris",
    tags: ["Sandbox"],
    summary: "Buat QRIS sandbox (tanpa merchant, tanpa pooling)",
    request: {
      body: { content: { "application/json": { schema: createQrisReq } } },
    },
    responses: {
      200: {
        description: "QRIS sandbox dibuat",
        content: { "application/json": { schema: createSandboxRes } },
      },
      400: {
        description: "Nominal tidak valid",
        content: { "application/json": { schema: errorRes } },
      },
    },
  }),
  createSandboxQris,
);
reg(
  createRoute({
    method: "post",
    path: "/sandbox/qris/{id}/simulate-pay",
    tags: ["Sandbox"],
    summary: "Simulasi bayar QRIS sandbox (kirim webhook)",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Simulasi lunas",
        content: { "application/json": { schema: simulatePayRes } },
      },
      404: {
        description: "QRIS sandbox tidak ditemukan",
        content: { "application/json": { schema: errorRes } },
      },
    },
  }),
  simulateSandboxPay,
);
reg(
  createRoute({
    method: "post",
    path: "/sandbox/qris/{id}/simulate-expire",
    tags: ["Sandbox"],
    summary: "Simulasi expired QRIS sandbox (kirim webhook)",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Simulasi kedaluwarsa",
        content: { "application/json": { schema: simulateExpireRes } },
      },
      404: {
        description: "QRIS sandbox tidak ditemukan",
        content: { "application/json": { schema: errorRes } },
      },
    },
  }),
  simulateSandboxExpire,
);

export { v1Routes };
