import { eq, and, lt, desc, sql } from "drizzle-orm";
import { qris } from "../schema";
import type { Db } from "../client";

export type QrisRow = typeof qris.$inferSelect;

export async function insertQRIS(
  db: Db,
  r: {
    id: string;
    code: string;
    amount: number;
    baseAmount: number;
    uniqueCode: number;
    trxId: string;
    merchantId: string;
    createdAt: number;
    expiresAt: number;
  },
) {
  await db.insert(qris).values({
    id: r.id,
    code: r.code,
    amount: r.amount,
    base_amount: r.baseAmount,
    unique_code: r.uniqueCode,
    trx_id: r.trxId,
    merchant_id: r.merchantId,
    status: "PENDING",
    created_at: r.createdAt,
    expires_at: r.expiresAt,
  });
}

export async function getQRIS(db: Db, id: string): Promise<QrisRow | null> {
  const rows = await db.select().from(qris).where(eq(qris.id, id));
  return rows[0] ?? null;
}

export async function listQRIS(db: Db, limit = 50, offset = 0, merchantId?: string): Promise<QrisRow[]> {
  const conds = [];
  if (merchantId) conds.push(eq(qris.merchant_id, merchantId));
  return db
    .select()
    .from(qris)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(qris.created_at))
    .limit(limit)
    .offset(offset);
}

export async function countQRIS(db: Db, merchantId?: string): Promise<number> {
  const conds = [];
  if (merchantId) conds.push(eq(qris.merchant_id, merchantId));
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(qris)
    .where(conds.length ? and(...conds) : undefined);
  return Number(r[0]?.c ?? 0);
}

export async function markQRISPaid(db: Db, id: string, transactionJson: string) {
  await db
    .update(qris)
    .set({ status: "PAID", transaction_json: transactionJson })
    .where(eq(qris.id, id));
}

export async function markQRISExpired(db: Db, now = Date.now(), merchantId?: string) {
  const conds: any[] = [and(eq(qris.status, "PENDING"), lt(qris.expires_at, now))];
  if (merchantId) conds.push(eq(qris.merchant_id, merchantId));
  await db.update(qris).set({ status: "EXPIRED" }).where(and(...conds));
}
