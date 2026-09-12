import { eq, lt, and, gte, sql } from "drizzle-orm";
import { claims, merchants } from "../schema";
import type { Db } from "../client";
import { startOfTodayWib } from "../../utils/day";

export async function claimTx(
  db: Db,
  txId: string,
  transactionId: string | null,
  merchantId?: string,
  claimedAt = Date.now(),
): Promise<boolean> {
  const rows = await db
    .insert(claims)
    .values({ tx_id: txId, transaction_id: transactionId, merchant_id: merchantId ?? null, claimed_at: claimedAt })
    .onConflictDoNothing({ target: claims.tx_id })
    .returning({ tx_id: claims.tx_id });
  return rows.length > 0;
}

export async function getClaim(db: Db, txId: string): Promise<typeof claims.$inferSelect | null> {
  const rows = await db.select().from(claims).where(eq(claims.tx_id, txId));
  return rows[0] ?? null;
}

/** Jumlah transaksi PAID (claimed) hari ini (WIB) untuk satu user, dihitung dari seluruh merchant miliknya. */
export async function countPaidToday(db: Db, userId: string): Promise<number> {
  const dayStart = startOfTodayWib();
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(claims)
    .innerJoin(merchants, eq(claims.merchant_id, merchants.id))
    .where(and(eq(merchants.user_id, userId), gte(claims.claimed_at, dayStart)));
  return Number(rows[0]?.c ?? 0);
}

export async function cleanOldClaims(db: Db, before = Date.now() - 24 * 60 * 60 * 1000) {
  await db.delete(claims).where(lt(claims.claimed_at, before));
}
