import { eq, and, or, ilike, lt, gte, lte, desc, sql, isNotNull } from "drizzle-orm";
import { transactions, merchants } from "../schema";
import type { Db } from "../client";

export type TransactionRow = typeof transactions.$inferSelect;

export type TransactionStatus = "pending" | "paid" | "expired";

/** ponytail: fee derive pay-base-code, no kolom DB. Upgrade ke kolom fee_amount saat butuh SUM fee / komponen charge baru (pajak/diskon). */
export function feeOf(t: { amount: number; base_amount: number | null; unique_code: number | null }): number {
  const base = t.base_amount ?? 0;
  if (base <= 0) return 0;
  return Math.max(0, t.amount - base - (t.unique_code ?? 0));
}

export async function insertTransaction(
  db: Db,
  r: {
    id: string;
    code: string;
    amount: number;
    baseAmount: number;
    uniqueCode: number;
    trxId: string;
    merchantId: string | null;
    userId: string;
    createdAt: number;
    expiresAt: number;
    type?: "merchant" | "subscription";
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
    status: "pending",
    type: r.type ?? "merchant",
    created_at: r.createdAt,
    expires_at: r.expiresAt,
  });
}

export async function getTransaction(
  db: Db,
  id: string,
): Promise<TransactionRow | null> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id));
  return rows[0] ?? null;
}

export async function getTransactionByTrx(
  db: Db,
  trxId: string,
): Promise<TransactionRow | null> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.trx_id, trxId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateTransactionStatus(
  db: Db,
  id: string,
  status: TransactionStatus,
) {
  await db.update(transactions).set({ status }).where(eq(transactions.id, id));
}

type TransactionWithMerchant = TransactionRow & {
  merchant_name: string | null;
};

type TxFilter = {
  merchantId?: string;
  userId?: string;
  status?: TransactionStatus;
  q?: string;
  createdFrom?: number;
  createdTo?: number;
  expiresFrom?: number;
  expiresTo?: number;
  excludeSandbox?: boolean;
};

function txConds(o: TxFilter) {
  const conds = [];
  if (o.merchantId) conds.push(eq(transactions.merchant_id, o.merchantId));
  if (o.userId) conds.push(eq(transactions.user_id, o.userId));
  if (o.excludeSandbox) conds.push(isNotNull(transactions.merchant_id));
  if (o.status) conds.push(eq(transactions.status, o.status));
  if (o.q) {
    const like = `%${o.q}%`;
    conds.push(
      or(ilike(transactions.trx_id, like), ilike(merchants.name, like)),
    );
  }
  if (o.createdFrom !== undefined)
    conds.push(gte(transactions.created_at, o.createdFrom));
  if (o.createdTo !== undefined)
    conds.push(lte(transactions.created_at, o.createdTo));
  if (o.expiresFrom !== undefined)
    conds.push(gte(transactions.expires_at, o.expiresFrom));
  if (o.expiresTo !== undefined)
    conds.push(lte(transactions.expires_at, o.expiresTo));
  return conds;
}

export async function queryTransactions(
  db: Db,
  opts: TxFilter & { limit?: number; offset?: number } = {},
): Promise<TransactionWithMerchant[]> {
  const { limit = 50, offset = 0, ...rest } = opts;
  const rows = await db
    .select({ t: transactions, m: merchants })
    .from(transactions)
    .leftJoin(merchants, eq(transactions.merchant_id, merchants.id))
    .where(txConds(rest).length ? and(...txConds(rest)) : undefined)
    .orderBy(desc(transactions.created_at))
    .limit(limit)
    .offset(offset);
  return rows.map(({ t, m }) => ({ ...t, merchant_name: m?.name ?? null }));
}

/** Count per status dalam 1 query. Total = semua (tanpa filter status/merchant/tanggal). */
export async function countTransactionsByStatus(
  db: Db,
  o: TxFilter = {},
): Promise<{ total: number; pending: number; paid: number; expired: number }> {
  const conds = txConds(o);
  const r = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${transactions.status} = 'pending')::int`,
      paid: sql<number>`count(*) filter (where ${transactions.status} = 'paid')::int`,
      expired: sql<number>`count(*) filter (where ${transactions.status} = 'expired')::int`,
    })
    .from(transactions)
    .where(conds.length ? and(...conds) : undefined);
  return r[0] ?? { total: 0, pending: 0, paid: 0, expired: 0 };
}

export async function paidTransactionsInRange(
  db: Db,
  opts: { from: number; to: number; userId?: string },
): Promise<Array<{ amount: number; created_at: number }>> {
  const conds = [
    eq(transactions.status, "paid"),
    gte(transactions.created_at, opts.from),
    lte(transactions.created_at, opts.to),
  ];
  if (opts.userId) conds.push(eq(transactions.user_id, opts.userId));
  return db
    .select({
      amount: transactions.amount,
      created_at: transactions.created_at,
    })
    .from(transactions)
    .where(and(...conds));
}

/** Pendapatan PAID per merchant sejak `from` (epoch ms), diurutkan terbesar → terkecil. */
export async function paidIncomeByMerchant(
  db: Db,
  from: number,
  userId?: string,
): Promise<
  Array<{ merchant_id: string; merchant_name: string | null; total: number }>
> {
  const conds = [
    eq(transactions.status, "paid"),
    gte(transactions.created_at, from),
  ];
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
    merchant_name: r.merchant_name ?? (r.merchant_id ? null : "Sandbox"),
    total: Number(r.total ?? 0),
  }));
}

export async function markTransactionsExpired(
  db: Db,
  now = Date.now(),
  merchantId?: string,
) {
  const conds: any[] = [
    and(eq(transactions.status, "pending"), lt(transactions.expires_at, now)),
  ];
  if (merchantId) conds.push(eq(transactions.merchant_id, merchantId));
  await db
    .update(transactions)
    .set({ status: "expired" })
    .where(and(...conds));
}
