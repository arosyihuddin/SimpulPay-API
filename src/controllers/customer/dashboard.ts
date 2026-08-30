import { insertQRIS, listQRIS, countQRIS, markQRISExpired, insertLog } from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { loadSession, isExpired } from "../../services/sessionManager";
import { generateDynamicQRIS, qrisExpiryMs, uniqueAmount, getQrisStatic } from "../../services/qris";
import { formatTransaction, toRupiah } from "../../services/gojek";
import { broadcast } from "../../services/realtime";
import { bad, reqMerchant, fetchMonthTransactions } from "./helpers";
import { checkDailyPaidLimit } from "../../services/limits";

export async function dashboard(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  const session = await loadSession(DB, merchantId);
  await markQRISExpired(DB, Date.now(), merchantId);
  const qrisAll = await listQRIS(DB, 100, 0, merchantId);
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIncome = qrisAll
    .filter((q) => q.status === "PAID" && q.created_at >= todayStart.getTime())
    .reduce((sum, q) => sum + q.amount, 0);
  const activeQris = qrisAll.filter((q) => q.status === "PENDING" && q.expires_at > now).length;
  const tx = await fetchMonthTransactions(DB, merchantId);
  const monthIncome = tx.success
    ? tx.raw.reduce((sum: number, t: any) => sum + toRupiah(t.gross_amount || t.real_gross_amount), 0)
    : null;
  return c.json({
    success: true,
    data: {
      stats: {
        today_income: todayIncome,
        month_income: monthIncome,
        total_transactions: tx.success ? tx.raw.length : null,
        active_qris: activeQris,
        total_qris: qrisAll.length,
      },
      gobiz_session: session
        ? { exists: true, phone: session.phone_number, outlet: session.outlet_name, merchant_id: session.merchant_id, expired: isExpired(session), expires_at: session.expires_at }
        : { exists: false },
      month_fetch_error: tx.message ?? null,
    },
  });
}

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
  await insertQRIS(DB, { id: qrisId, code: dynamicCode!, amount: pay, baseAmount: base, uniqueCode: code, trxId, merchantId, createdAt: now, expiresAt });
  await insertLog(DB, "INFO", "Admin buat QRIS | Merchant " + merchantId + " | TRX-ID: " + trxId + " | Rp " + base + " (+" + code + ")");
  broadcast(c.env, { type: "qris_created", scope: "admin", data: { id: qrisId, merchantId, status: "PENDING" } });
  return c.json({
    success: true,
    data: { qris_id: qrisId, trx_id: trxId, qris_url: "/qr/" + qrisId, qris_code: dynamicCode, amount: base, unique_code: code, amount_to_pay: pay, expires_at: new Date(expiresAt).toISOString() },
  });
}

export async function listQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  await markQRISExpired(DB, Date.now(), merchantId);
  return c.json({ success: true, data: { qris: await listQRIS(DB, limit, offset, merchantId), total: await countQRIS(DB, merchantId) } });
}

export async function listTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  const q = c.req.query();
  const tx = await fetchMonthTransactions(DB, merchantId);
  if (!tx.success) return c.json({ success: false, data: { message: tx.message } });
  const total = tx.raw.length;
  const pageSize = parseInt((q.pageSize as string) || "20", 10);
  const page = parseInt((q.page as string) || "1", 10);
  const formatted = tx.raw.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map(formatTransaction);
  return c.json({ success: true, data: { transactions: formatted, total } });
}