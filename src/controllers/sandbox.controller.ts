import type { Context } from "hono";
import type { AppEnv } from "../types";
import { getDb } from "../db/client";
import { uniqueAmount } from "../services/qris";
import {
  SETTINGS_DEFAULTS,
  qrisExpiryMs,
  amountLimitError,
  feeAmount,
} from "../services/settings";
import {
  insertTransaction,
  getTransaction,
  getTransactionByTrx,
  updateTransactionStatus,
  insertLog,
  getUserSettings,
  feeOf,
} from "../db/repositories";
import { sendWebhook } from "../services/webhook";
import { broadcast } from "../services/realtime";
import { createNotifications } from "../utils/notification.helper";
import { fail, ok } from "../middleware/errorHandler";

/**
 * Sandbox = transaksi QRIS tanpa merchant (merchant_id NULL, milik user).
 * Format respon = real, tapi kode QR dummy (bukan QRIS valid, tak bisa dibayar
 * beneran) dan tanpa GoBiz session / static QRIS / pooling. Bayar = tombol
 * simulate-pay → flip paid + webhook transaction.paid asli.
 */
function sandboxSettings(s: Record<string, string>): Record<string, string> {
  return { ...SETTINGS_DEFAULTS, ...s };
}

export async function createSandboxQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.get("user")?.userId;
  if (!userId) fail(500, "userId tidak ditemukan di context");
  const body = await c.req.json().catch(() => null);
  const base = parseInt(String(body?.amount ?? ""), 10);
  if (Number.isNaN(base) || base <= 0)
    fail(400, "Nominal pembayaran tidak valid");
  const cfg = sandboxSettings(await getUserSettings(DB, userId));
  const limitErr = amountLimitError(base, cfg);
  if (limitErr) fail(400, limitErr);
  const fee = feeAmount(base, cfg);
  const { code, pay } = uniqueAmount(base + fee);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId =
    "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const now = Date.now();
  const expiresAt = now + qrisExpiryMs(cfg);
  const dummy = `SANDBOX:${qrisId}:${pay}`;
  await insertTransaction(DB, {
    id: qrisId,
    code: dummy,
    amount: pay,
    baseAmount: base,
    uniqueCode: code,
    trxId,
    merchantId: null,
    userId,
    createdAt: now,
    expiresAt,
  });
  await insertLog(
    DB,
    "INFO",
    `QRIS sandbox dibuat | TRX-ID: ${trxId} | Rp ${base} (+${code})`,
    null,
    userId,
  );
  broadcast(c.env, {
    type: "qris_created",
    userId,
    data: {
      id: qrisId,
      trx_id: trxId,
      merchantId: null,
      amount_to_pay: pay,
      status: "pending",
      expires_at: expiresAt,
    },
  });
  return c.json(
    ok({
      data: {
        qris_id: qrisId,
        trx_id: trxId,
        merchant_id: null,
        qris_code: dummy,
        amount: base,
        fee_amount: fee,
        unique_code: code,
        amount_to_pay: pay,
        expires_at: expiresAt,
      },
    }),
  );
}

export async function simulateSandboxPay(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.get("user")?.userId;
  if (!userId) fail(500, "userId tidak ditemukan di context");
  const key = (c.req.param("id") ?? "").trim();
  const t = (await getTransactionByTrx(DB, key)) ?? (await getTransaction(DB, key));
  if (!t || t.merchant_id !== null || t.user_id !== userId)
    fail(404, "QRIS sandbox tidak ditemukan");
  if (t.status === "paid") return c.json(ok({ paid: true, already: true }));
  if (t.status === "expired" || Date.now() > t.expires_at)
    fail(410, "QRIS sandbox sudah kedaluwarsa");
  const now = Date.now();
  await updateTransactionStatus(DB, t.id, "paid");
  await sendWebhook(DB, userId, "transaction.paid", {
    trx_id: t.trx_id,
    amount: t.amount,
    base_amount: t.base_amount,
    unique_code: t.unique_code,
    fee_amount: feeOf(t),
    merchant_id: null,
    merchant_name: "Sandbox",
    paid_at: now,
  });
  broadcast(c.env, {
    type: "payment_received",
    userId,
    data: { id: t.id, trx_id: t.trx_id, status: "paid", amount: t.amount },
  });
  broadcast(c.env, {
    type: "transaction_updated",
    userId,
    data: {
      id: t.id,
      trx_id: t.trx_id,
      merchantId: null,
      status: "paid",
      amount: t.amount,
      paid_at: now,
    },
  });
  await createNotifications(DB, c.env, {
    type: "payment_success",
    toUser: {
      userId,
      title: "Pembayaran Berhasil",
      message: `Sandbox Rp${t.amount.toLocaleString("id-ID")} lunas (TRX ${t.trx_id})`,
    },
  });
  await insertLog(
    DB,
    "SUCCESS",
    `Sandbox lunas (simulasi) | TRX-ID: ${t.trx_id} | Rp ${t.amount}`,
    t.id,
    userId,
  );
  return c.json(ok({ paid: true }));
}

export async function simulateSandboxExpire(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.get("user")?.userId;
  if (!userId) fail(500, "userId tidak ditemukan di context");
  const key = (c.req.param("id") ?? "").trim();
  const t = (await getTransactionByTrx(DB, key)) ?? (await getTransaction(DB, key));
  if (!t || t.merchant_id !== null || t.user_id !== userId)
    fail(404, "QRIS sandbox tidak ditemukan");
  if (t.status === "expired")
    return c.json(ok({ expired: true, already: true }));
  if (t.status === "paid") fail(400, "QRIS sandbox sudah lunas");
  const now = Date.now();
  await updateTransactionStatus(DB, t.id, "expired");
  await sendWebhook(DB, userId, "transaction.expired", {
    trx_id: t.trx_id,
    amount: t.amount,
    base_amount: t.base_amount,
    unique_code: t.unique_code,
    fee_amount: feeOf(t),
    merchant_id: null,
    expired_at: now,
  });
  broadcast(c.env, {
    type: "qris_expired",
    userId,
    data: { id: t.id, trx_id: t.trx_id, merchantId: null, status: "expired" },
  });
  broadcast(c.env, {
    type: "transaction_updated",
    userId,
    data: {
      id: t.id,
      trx_id: t.trx_id,
      merchantId: null,
      status: "expired",
      amount: t.amount,
      expired_at: now,
    },
  });
  await insertLog(
    DB,
    "INFO",
    `Sandbox kedaluwarsa (simulasi) | TRX-ID: ${t.trx_id} | Rp ${t.amount}`,
    t.id,
    userId,
  );
  return c.json(ok({ expired: true }));
}
