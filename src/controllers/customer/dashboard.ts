import {
  markTransactionsExpired,
  queryTransactions,
  paidIncomeByMerchant,
  topPaidTransactionsByMerchant,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { currentUserId } from "./helpers";

export async function dashboard(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  await markTransactionsExpired(DB, Date.now());
  const all = await queryTransactions(DB, { limit: 100, userId });
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const d = new Date();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
  const todayIncome = all
    .filter((q) => q.status === "PAID" && q.created_at >= todayStart.getTime())
    .reduce((s, q) => s + q.amount, 0);
  const monthIncome = all
    .filter((q) => q.status === "PAID" && q.created_at >= monthStart.getTime())
    .reduce((s, q) => s + q.amount, 0);
  const activeQris = all.filter(
    (q) => q.status === "PENDING" && q.expires_at > now,
  ).length;
  const merchantIncome = await paidIncomeByMerchant(DB, monthStart.getTime(), userId);
  const topMerchants = merchantIncome.slice(0, 5).map((m, i) => ({
    rank: i + 1,
    merchant_id: m.merchant_id,
    merchant_name: m.merchant_name,
    total: m.total / 100,
  }));
  return c.json({
    success: true,
    data: {
      stats: {
        today_income: todayIncome,
        month_income: monthIncome,
        total_transactions: all.length,
        active_qris: activeQris,
        total_qris: all.length,
      },
      top_merchants: topMerchants,
      month_fetch_error: null,
    },
  });
}

/** Top merchant by jumlah transaksi PAID bulan ini. */
export async function topMerchantsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const to = Date.now();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "5", 10) || 5, 50);
  const top = await topPaidTransactionsByMerchant(DB, { from, to, userId, limit });
  return c.json({
    success: true,
    data: {
      period: { from, to },
      merchants: top.map((m, i) => ({ rank: i + 1, ...m })),
    },
  });
}
