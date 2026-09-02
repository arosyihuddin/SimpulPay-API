import { eq, and, or, desc, sql, ilike } from "drizzle-orm";
import { invoices, users } from "../schema";
import type { Db } from "../client";

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceWithUser = InvoiceRow & {
  user_name: string | null;
  user_email: string | null;
};

export async function createInvoice(
  db: Db,
  inv: {
    id: string;
    userId: string;
    subscriptionId: string;
    transactionId?: string;
    amount: number;
    status?: "pending" | "paid" | "overdue" | "failed";
    periodStart: number;
    periodEnd: number;
    paidAt?: number | null;
  },
) {
  await db.insert(invoices).values({
    id: inv.id,
    user_id: inv.userId,
    subscription_id: inv.subscriptionId,
    transaction_id: inv.transactionId ?? null,
    amount: inv.amount,
    status: inv.status ?? "pending",
    period_start: inv.periodStart,
    period_end: inv.periodEnd,
    paid_at: inv.paidAt ?? null,
    created_at: Date.now(),
  });
}

export async function getInvoice(db: Db, id: string): Promise<InvoiceRow | null> {
  const rows = await db.select().from(invoices).where(eq(invoices.id, id));
  return rows[0] ?? null;
}

/** Invoice yang merujuk ke transaksi QRIS tertentu (via transaction_id). */
export async function getInvoiceByTransaction(
  db: Db,
  transactionId: string,
): Promise<InvoiceRow | null> {
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.transaction_id, transactionId));
  return rows[0] ?? null;
}

export async function listInvoices(
  db: Db,
  opts: {
    userId?: string;
    subscriptionId?: string;
    status?: "pending" | "paid" | "overdue" | "failed";
    q?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<InvoiceWithUser[]> {
  const conds = [];
  if (opts.userId) conds.push(eq(invoices.user_id, opts.userId));
  if (opts.subscriptionId) conds.push(eq(invoices.subscription_id, opts.subscriptionId));
  if (opts.status) conds.push(eq(invoices.status, opts.status));
  if (opts.q) {
    const like = `%${opts.q}%`;
    conds.push(or(ilike(users.name, like), ilike(users.email, like)));
  }
  const rows = await db
    .select({ i: invoices, u: users })
    .from(invoices)
    .leftJoin(users, eq(users.id, invoices.user_id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(invoices.created_at))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
  return rows.map(({ i, u }) => ({ ...i, user_name: u?.name ?? null, user_email: u?.email ?? null }));
}

export async function updateInvoiceStatus(
  db: Db,
  id: string,
  status: "pending" | "paid" | "overdue" | "failed",
  paidAt?: number | null,
) {
  const sets: Record<string, unknown> = { status };
  if (paidAt !== undefined) sets.paid_at = paidAt;
  await db.update(invoices).set(sets).where(eq(invoices.id, id));
}

/** Tandai invoice yang merujuk ke transaksi QRIS tertentu (via transaction_id). */
export async function updateInvoiceByTransaction(
  db: Db,
  transactionId: string,
  status: "paid" | "failed",
  paidAt?: number | null,
) {
  const sets: Record<string, unknown> = { status };
  if (paidAt !== undefined) sets.paid_at = paidAt;
  await db
    .update(invoices)
    .set(sets)
    .where(eq(invoices.transaction_id, transactionId));
}

/** Total + count per status dalam 1 query (status filter diabaikan — hitungan global). */
export async function countInvoicesByStatus(
  db: Db,
  o: { userId?: string; q?: string } = {},
): Promise<{ total: number; pending: number; paid: number; overdue: number; failed: number }> {
  const conds = [];
  if (o.userId) conds.push(eq(invoices.user_id, o.userId));
  if (o.q) {
    const like = `%${o.q}%`;
    conds.push(or(ilike(users.name, like), ilike(users.email, like)));
  }
  const r = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${invoices.status} = 'pending')::int`,
      paid: sql<number>`count(*) filter (where ${invoices.status} = 'paid')::int`,
      overdue: sql<number>`count(*) filter (where ${invoices.status} = 'overdue')::int`,
      failed: sql<number>`count(*) filter (where ${invoices.status} = 'failed')::int`,
    })
    .from(invoices)
    .leftJoin(users, eq(users.id, invoices.user_id))
    .where(conds.length ? and(...conds) : undefined);
  return r[0] ?? { total: 0, pending: 0, paid: 0, overdue: 0, failed: 0 };
}
