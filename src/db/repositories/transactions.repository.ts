import { eq, and, lt, desc, sql } from "drizzle-orm";
import { transactions } from "../schema";
import type { Db } from "../client";

export type TransactionRow = typeof transactions.$inferSelect;

export async function insertTransaction(
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
  await db.insert(transactions).values({
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

export async function getTransaction(db: Db, id: string): Promise<TransactionRow | null> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id));
  return rows[0] ?? null;
}

export async function queryTransactions(
  db: Db,
  opts: { limit?: number; offset?: number; merchantId?: string; status?: string } = {},
): Promise<TransactionRow[]> {
  const { limit = 50, offset = 0, merchantId, status } = opts;
  const conds = [];
  if (merchantId) conds.push(eq(transactions.merchant_id, merchantId));
  if (status) conds.push(eq(transactions.status, status));
  return db
    .select()
    .from(transactions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(transactions.created_at))
    .limit(limit)
    .offset(offset);
}

export async function countTransactions(
  db: Db,
  opts: { merchantId?: string; status?: string } = {},
): Promise<number> {
  const { merchantId, status } = opts;
  const conds = [];
  if (merchantId) conds.push(eq(transactions.merchant_id, merchantId));
  if (status) conds.push(eq(transactions.status, status));
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(transactions)
    .where(conds.length ? and(...conds) : undefined);
  return Number(r[0]?.c ?? 0);
}

export async function markTransactionPaid(db: Db, id: string, transactionJson: string) {
  await db
    .update(transactions)
    .set({ status: "PAID", transaction_json: transactionJson })
    .where(eq(transactions.id, id));
}

export async function markTransactionsExpired(db: Db, now = Date.now(), merchantId?: string) {
  const conds: any[] = [and(eq(transactions.status, "PENDING"), lt(transactions.expires_at, now))];
  if (merchantId) conds.push(eq(transactions.merchant_id, merchantId));
  await db.update(transactions).set({ status: "EXPIRED" }).where(and(...conds));
}
