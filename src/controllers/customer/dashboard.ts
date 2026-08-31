import {
  getMerchant,
  markTransactionsExpired,
  queryTransactions,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { loadSession, isExpired } from "../../services/sessionManager";
import { toRupiah } from "../../services/gojek";
import { bad, currentUserId, fetchMonthTransactions } from "./helpers";

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
        stats: {
          today_income: 0,
          month_income: null,
          total_transactions: 0,
          active_qris: 0,
          total_qris: 0,
        },
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
  const activeQris = qrisAll.filter(
    (q) => q.status === "PENDING" && q.expires_at > now,
  ).length;
  const tx = await fetchMonthTransactions(DB, merchantId);
  const monthIncome = tx.success
    ? tx.raw.reduce(
        (sum: number, t: any) =>
          sum + toRupiah(t.gross_amount || t.real_gross_amount),
        0,
      )
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
        ? {
            exists: true,
            phone: session.phone_number,
            outlet: session.outlet_name,
            merchant_id: session.merchant_id,
            expired: isExpired(session),
            expires_at: session.expires_at,
          }
        : { exists: false },
      month_fetch_error: tx.message ?? null,
    },
  });
}
