import { markTransactionsExpired, queryTransactions } from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";

export async function dashboard(c: Context<AppEnv>) {
  const DB = getDb(c);
  await markTransactionsExpired(DB, Date.now());
  const all = await queryTransactions(DB, { limit: 100 });
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
      month_fetch_error: null,
    },
  });
}
