import { eq, and, lt, gte, lte, desc, sql } from "drizzle-orm";
import { transactions, merchants } from "../schema";
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
    userId: string;
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
    user_id: r.userId,
    status: "PENDING",
    created_at: r.createdAt,
    expires_at: r.expiresAt,
  });
}

export async function getTransaction(db: Db, id: string): Promise<TransactionRow | null> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id));
  return rows[0] ?? null;
}

export async function updateTransactionStatus(db: Db, id: string, status: string) {
  await db.update(transactions).set({ status }).where(eq(transactions.id, id));
}

type TransactionWithMerchant = TransactionRow & {
  merchant_name: string | null;
};

export async function queryTransactions(
  db: Db,
  opts: { limit?: number; offset?: number; merchantId?: string; userId?: string; status?: string } = {},
): Promise<TransactionWithMerchant[]> {
  const { limit = 50, offset = 0, merchantId, userId, status } = opts;
  const conds = [];
  if (merchantId) conds.push(eq(transactions.merchant_id, merchantId));
  if (userId) conds.push(eq(transactions.user_id, userId));
  if (status) conds.push(eq(transactions.status, status));
  const rows = await db
    .select({ t: transactions, m: merchants })
    .from(transactions)
    .leftJoin(merchants, eq(transactions.merchant_id, merchants.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(transactions.created_at))
    .limit(limit)
    .offset(offset);
  return rows.map(({ t, m }) => ({ ...t, merchant_name: m?.name ?? null }));
}

export async function countTransactions(
  db: Db,
  opts: { merchantId?: string; userId?: string; status?: string } = {},
): Promise<number> {
  const { merchantId, userId, status } = opts;
  const conds = [];
  if (merchantId) conds.push(eq(transactions.merchant_id, merchantId));
  if (userId) conds.push(eq(transactions.user_id, userId));
  if (status) conds.push(eq(transactions.status, status));
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(transactions)
    .where(conds.length ? and(...conds) : undefined);
  return Number(r[0]?.c ?? 0);
}

export async function paidTransactionsInRange(
  db: Db,
  opts: { from: number; to: number; userId?: string },
): Promise<Array<{ amount: number; created_at: number }>> {
  const conds = [
    eq(transactions.status, "PAID"),
    gte(transactions.created_at, opts.from),
    lte(transactions.created_at, opts.to),
  ];
  if (opts.userId) conds.push(eq(transactions.user_id, opts.userId));
  return db
    .select({ amount: transactions.amount, created_at: transactions.created_at })
    .from(transactions)
    .where(and(...conds));
}

/** Pendapatan PAID per merchant sejak `from` (epoch ms), diurutkan terbesar → terkecil. */
export async function paidIncomeByMerchant(
  db: Db,
  from: number,
  userId?: string,
): Promise<Array<{ merchant_id: string; merchant_name: string | null; total: number }>> {
  const conds = [eq(transactions.status, "PAID"), gte(transactions.created_at, from)];
  if (userId) conds.push(eq(transactions.user_id, userId));
  const rows = await db
    .select({
      merchant_id: transactions.merchant_id,
      merchant_name: merchants.name,
      total: sql<number>`sum(${transactions.amount})::bigint`,
    })
    .from(transactions)
    .leftJoin(merchants, eq(transactions.merchant_id, merchants.id))
    .where(and(...conds))
    .groupBy(transactions.merchant_id, merchants.name)
    .orderBy(desc(sql`sum(${transactions.amount})`));
  return rows.map((r) => ({
    merchant_id: r.merchant_id ?? "",
    merchant_name: r.merchant_name,
    total: Number(r.total ?? 0),
  }));
}

/** Top merchant by jumlah transaksi PAID dalam range, diurutkan terbanyak → paling sedikit. */
export async function topPaidTransactionsByMerchant(
  db: Db,
  opts: { from: number; to: number; userId?: string; limit?: number },
): Promise<
  Array<{ merchant_id: string; merchant_name: string | null; total_transactions: number }>
> {
  const conds = [
    eq(transactions.status, "PAID"),
    gte(transactions.created_at, opts.from),
    lte(transactions.created_at, opts.to),
  ];
  if (opts.userId) conds.push(eq(transactions.user_id, opts.userId));
  const rows = await db
    .select({
      merchant_id: transactions.merchant_id,
      merchant_name: merchants.name,
      total_transactions: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(merchants, eq(transactions.merchant_id, merchants.id))
    .where(and(...conds))
    .groupBy(transactions.merchant_id, merchants.name)
    .orderBy(desc(sql`count(*)`))
    .limit(opts.limit ?? 5);
  return rows.map((r) => ({
    merchant_id: r.merchant_id ?? "",
    merchant_name: r.merchant_name,
    total_transactions: Number(r.total_transactions ?? 0),
  }));
}

export async function markTransactionsExpired(db: Db, now = Date.now(), merchantId?: string) {
  const conds: any[] = [and(eq(transactions.status, "PENDING"), lt(transactions.expires_at, now))];
  if (merchantId) conds.push(eq(transactions.merchant_id, merchantId));
  await db.update(transactions).set({ status: "EXPIRED" }).where(and(...conds));
}
