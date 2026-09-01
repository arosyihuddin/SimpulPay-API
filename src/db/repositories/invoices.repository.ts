import { eq, and, desc, sql } from "drizzle-orm";
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

export async function listInvoices(
  db: Db,
  opts: {
    userId?: string;
    subscriptionId?: string;
    status?: "pending" | "paid" | "overdue" | "failed";
    limit?: number;
    offset?: number;
  } = {},
): Promise<InvoiceWithUser[]> {
  const conds = [];
  if (opts.userId) conds.push(eq(invoices.user_id, opts.userId));
  if (opts.subscriptionId) conds.push(eq(invoices.subscription_id, opts.subscriptionId));
  if (opts.status) conds.push(eq(invoices.status, opts.status));
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

export async function countInvoices(db: Db, userId?: string): Promise<number> {
  const conds = [];
  if (userId) conds.push(eq(invoices.user_id, userId));
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(invoices)
    .where(conds.length ? and(...conds) : undefined);
  return Number(r[0]?.c ?? 0);
}
