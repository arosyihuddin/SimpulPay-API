import type { Db } from "../db/client";
import { getMerchant, getActiveSubscription, getPlan, countPaidToday } from "../db/repositories";

/**
 * Cek batas transaksi PAID harian untuk user pemilik merchant.
 * Return null kalau gak ada batas (unlimited). Return { used, limit } kalau mentok.
 */
export async function checkDailyPaidLimit(
  db: Db,
  merchantId: string,
): Promise<{ used: number; limit: number } | null> {
  const merchant = await getMerchant(db, merchantId);
  if (!merchant) return null;
  const sub = await getActiveSubscription(db, merchant.user_id);
  const plan = sub ? await getPlan(db, sub.plan_id) : null;
  const limit = plan?.daily_paid_limit ?? null;
  if (limit === null) return null;
  const used = await countPaidToday(db, merchant.user_id);
  return used >= limit ? { used, limit } : null;
}
