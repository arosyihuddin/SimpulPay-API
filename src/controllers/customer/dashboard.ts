import { insertTransaction, queryTransactions, countTransactions, markTransactionsExpired, insertLog, recentLogsByUser, countLogsByUser, getMerchant } from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { loadSession, isExpired } from "../../services/sessionManager";
import { generateDynamicQRIS, qrisExpiryMs, uniqueAmount, getQrisStatic } from "../../services/qris";
import { formatTransaction, toRupiah } from "../../services/gojek";
import { broadcast } from "../../services/realtime";
import { bad, reqMerchant, fetchMonthTransactions, currentUserId, paramId } from "./helpers";
import { checkDailyPaidLimit } from "../../services/limits";

export async function dashboard(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  // Tanpa merchantGuard di route: resolve merchant manual, tolerir kosong.
  const merchantId =
    c.req.query("merchant_id") || c.req.header("x-merchant-id") || null;
  if (merchantId) {
    const merchant = await getMerchant(DB, merchantId);
    if (!merchant || merchant.user_id !== userId)
      bad("Merchant tidak ditemukan", 404);
    if (merchant.status !== "active") bad("Merchant tidak aktif", 403);
  }
  // Empty state: user belum punya merchant → statistik nol, frontend kasih onboarding.
  if (!merchantId)
    return c.json({
      success: true,
      data: {
        has_merchant: false,
        stats: { today_income: 0, month_income: null, total_transactions: 0, active_qris: 0, total_qris: 0 },
        gobiz_session: { exists: false },
        month_fetch_error: null,
      },
    });
  const session = await loadSession(DB, merchantId);
  await markTransactionsExpired(DB, Date.now(), merchantId);
  const qrisAll = await queryTransactions(DB, { limit: 100, merchantId });
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
      has_merchant: true,
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
  await insertTransaction(DB, { id: qrisId, code: dynamicCode!, amount: pay, baseAmount: base, uniqueCode: code, trxId, merchantId, createdAt: now, expiresAt });
  await insertLog(DB, "INFO", "Admin buat QRIS | Merchant " + merchantId + " | TRX-ID: " + trxId + " | Rp " + base + " (+" + code + ")");
  broadcast(c.env, { type: "qris_created", scope: "admin", data: { id: qrisId, merchantId, status: "PENDING" } });
  return c.json({
    success: true,
    data: { qris_id: qrisId, trx_id: trxId, qris_url: "/qr/" + qrisId, qris_code: dynamicCode, amount: base, unique_code: code, amount_to_pay: pay, expires_at: new Date(expiresAt).toISOString() },
  });
}

export async function listLogsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "100", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  return c.json({
    success: true,
    data: {
      logs: await recentLogsByUser(DB, userId, limit, offset),
      total: await countLogsByUser(DB, userId),
    },
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

/** Transaksi LIVE GoBiz — detail per merchant, butuh merchant milik user. */
export async function merchantTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchantId = paramId(c);
  const merchant = await getMerchant(DB, merchantId);
  if (!merchant || merchant.user_id !== userId) bad("Merchant tidak ditemukan", 404);
  const q = c.req.query();
  const tx = await fetchMonthTransactions(DB, merchantId);
  if (!tx.success) return c.json({ success: false, message: tx.message });
  const total = tx.raw.length;
  const pageSize = parseInt((q.pageSize as string) || "20", 10);
  const page = parseInt((q.page as string) || "1", 10);
  const formatted = tx.raw.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map(formatTransaction);
  return c.json({ success: true, data: { transactions: formatted, total } });
}