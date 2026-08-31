import {
  queryTransactions,
  countTransactions,
  markTransactionsExpired,
  getMerchant,
  insertTransaction,
  insertLog,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId, reqMerchant } from "./helpers";
import {
  generateDynamicQRIS,
  qrisExpiryMs,
  uniqueAmount,
  getQrisStatic,
} from "../../services/qris";
import { checkDailyPaidLimit } from "../../services/limits";
import { broadcast } from "../../services/realtime";

/** Buat QRIS dinamis → insert transaksi. */
export async function createQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  const body = await c.req.json();
  const amount = body?.amount;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) bad("Nominal pembayaran tidak valid");
  const staticTemplate = await getQrisStatic(DB, merchantId);
  if (!staticTemplate) bad("QRIS static belum dikonfigurasi. Upload QRIS static di Settings → Konfigurasi QRIS.", 500);
  const blocked = await checkDailyPaidLimit(DB, merchantId);
  if (blocked) bad(`Batas transaksi harian tercapai (${blocked.used}/${blocked.limit}). Silakan upgrade plan atau coba besok.`, 429);
  const base = parseInt(String(amount), 10);
  const { code, pay } = uniqueAmount(base);
  const dynamicCode = generateDynamicQRIS(staticTemplate, pay);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId = "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const now = Date.now();
  const expiresAt = now + qrisExpiryMs();
  await insertTransaction(DB, { id: qrisId, code: dynamicCode!, amount: pay, baseAmount: base, uniqueCode: code, trxId, merchantId, createdAt: now, expiresAt });
  await insertLog(DB, "INFO", "Admin buat QRIS | Merchant " + merchantId + " | TRX-ID: " + trxId + " | Rp " + base + " (+" + code + ")");
  broadcast(c.env, { type: "qris_created", scope: "admin", data: { id: qrisId, merchantId, status: "PENDING" } });
  return c.json({
    success: true,
    data: { qris_id: qrisId, trx_id: trxId, qris_url: "/qr/" + qrisId, qris_code: dynamicCode, amount: base, unique_code: code, amount_to_pay: pay, expires_at: new Date(expiresAt).toISOString() },
  });
}

/** Transaksi LOKAL — gabungan semua merchant user, filter status/merchant. */
export async function listTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  const status = (q.status as string) || undefined;
  const merchantId = (q.merchant_id as string) || undefined;
  if (merchantId) {
    const m = await getMerchant(DB, merchantId);
    if (!m || m.user_id !== userId) bad("Merchant tidak ditemukan", 404);
  }
  const opts = { limit, offset, status, merchantId };
  await markTransactionsExpired(DB, Date.now());
  const rows = await queryTransactions(DB, opts);
  const total = await countTransactions(DB, { status, merchantId });
  const txns = rows.map((t) => ({
    id: t.id,
    trx_id: t.trx_id,
    merchant_id: t.merchant_id,
    amount: t.amount,
    base_amount: t.base_amount,
    unique_code: t.unique_code,
    status: t.status,
    created_at: t.created_at,
    expires_at: t.expires_at,
  }));
  return c.json({ success: true, data: { transactions: txns, total } });
}
