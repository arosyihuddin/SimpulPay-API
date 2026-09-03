import {
  markTransactionsExpired,
  queryTransactions,
  paidIncomeByMerchant,
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
    .filter((q) => q.status === "paid" && q.created_at >= todayStart.getTime())
    .reduce((s, q) => s + q.amount, 0);
  const monthIncome = all
    .filter((q) => q.status === "paid" && q.created_at >= monthStart.getTime())
    .reduce((s, q) => s + q.amount, 0);
  const activeQris = all.filter(
    (q) => q.status === "pending" && q.expires_at > now,
  ).length;
  const merchantIncome = await paidIncomeByMerchant(DB, monthStart.getTime(), userId);
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

