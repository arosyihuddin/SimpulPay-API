import { eq, lt } from "drizzle-orm";
import { claims } from "../schema";
import type { Db } from "../client";

export async function claimTx(
  db: Db,
  txId: string,
  qrisId: string | null,
  merchantId?: string,
  claimedAt = Date.now(),
): Promise<boolean> {
  const rows = await db
    .insert(claims)
    .values({ tx_id: txId, qris_id: qrisId, merchant_id: merchantId ?? null, claimed_at: claimedAt })
    .onConflictDoNothing({ target: claims.tx_id })
    .returning({ tx_id: claims.tx_id });
  return rows.length > 0;
}

export async function getClaim(db: Db, txId: string): Promise<typeof claims.$inferSelect | null> {
  const rows = await db.select().from(claims).where(eq(claims.tx_id, txId));
  return rows[0] ?? null;
}

export async function cleanOldClaims(db: Db, before = Date.now() - 24 * 60 * 60 * 1000) {
  await db.delete(claims).where(lt(claims.claimed_at, before));
}
