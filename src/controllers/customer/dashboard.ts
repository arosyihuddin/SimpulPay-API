import {
  markTransactionsExpired,
  queryTransactions,
  paidIncomeByMerchant,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { startOfTodayWib, startOfMonthWib } from "../../utils/day";
import { currentUserId } from "./helpers";

export async function dashboard(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  await markTransactionsExpired(DB, Date.now());
  const all = await queryTransactions(DB, { limit: 100, userId });
  const now = Date.now();
  const todayStart = startOfTodayWib(now);
  const monthStart = startOfMonthWib(now);
  const todayIncome = all
    .filter((q) => q.status === "paid" && q.created_at >= todayStart)
    .reduce((s, q) => s + q.amount, 0);
  const monthIncome = all
    .filter((q) => q.status === "paid" && q.created_at >= monthStart)
    .reduce((s, q) => s + q.amount, 0);
  const activeQris = all.filter(
    (q) => q.status === "pending" && q.expires_at > now,
  ).length;
  const merchantIncome = await paidIncomeByMerchant(DB, monthStart, userId);
  const topMerchants = merchantIncome.slice(0, 5).map((m, i) => ({
    rank: i + 1,
    merchant_id: m.merchant_id,
    merchant_name: m.merchant_name,
    total: m.total,
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

