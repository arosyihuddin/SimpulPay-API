import { eq, and, desc, asc, lt, sql } from "drizzle-orm";
import { plans, subscriptions, invoices } from "../schema";
import type { Db } from "../client";

export type PlanRow = typeof plans.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;

// ── Plans ──────────────────────────────────────────

export async function createPlan(
  db: Db,
  p: {
    id: string;
    name: string;
    type?: "free" | "paid";
    price?: number;
    maxMerchants?: number;
    featuresJson?: string | null;
    active?: boolean;
  },
) {
  const now = Date.now();
  await db.insert(plans).values({
    id: p.id,
    name: p.name,
    type: p.type ?? "paid",
    price: p.price ?? 0,
    max_merchants: p.maxMerchants ?? 1,
    features_json: p.featuresJson ?? null,
    active: p.active ?? true,
    created_at: now,
    updated_at: now,
  });
}

export async function getPlan(db: Db, id: string): Promise<PlanRow | null> {
  const rows = await db.select().from(plans).where(eq(plans.id, id));
  return rows[0] ?? null;
}

export async function listPlans(db: Db, onlyActive = false): Promise<PlanRow[]> {
  const conds = [];
  if (onlyActive) conds.push(eq(plans.active, true));
  return db
    .select()
    .from(plans)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(plans.price));
}

export async function updatePlan(
  db: Db,
  id: string,
  p: {
    name?: string;
    type?: "free" | "paid";
    price?: number;
    maxMerchants?: number;
    featuresJson?: string | null;
    active?: boolean;
  },
) {
  const now = Date.now();
  const sets: Record<string, unknown> = { updated_at: now };
  if (p.name !== undefined) sets.name = p.name;
  if (p.type !== undefined) sets.type = p.type;
  if (p.price !== undefined) sets.price = p.price;
  if (p.maxMerchants !== undefined) sets.max_merchants = p.maxMerchants;
  if (p.featuresJson !== undefined) sets.features_json = p.featuresJson;
  if (p.active !== undefined) sets.active = p.active;
  if (Object.keys(sets).length === 1) return;
  await db.update(plans).set(sets).where(eq(plans.id, id));
}

export async function deletePlan(db: Db, id: string) {
  await db.delete(plans).where(eq(plans.id, id));
}

// ── Subscriptions (per user) ───────────────────────

export async function createSubscription(
  db: Db,
  s: {
    id: string;
    userId: string;
    planId: string;
    status?: "active" | "cancelled" | "expired";
    startsAt?: number;
    endsAt?: number | null;
  },
) {
  const now = s.startsAt ?? Date.now();
  await db.insert(subscriptions).values({
    id: s.id,
    user_id: s.userId,
    plan_id: s.planId,
    status: s.status ?? "active",
    starts_at: now,
    ends_at: s.endsAt ?? null,
    created_at: now,
    updated_at: now,
  });
}

export async function getSubscription(db: Db, id: string): Promise<SubscriptionRow | null> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  return rows[0] ?? null;
}

export async function getActiveSubscription(db: Db, userId: string): Promise<SubscriptionRow | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.user_id, userId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.created_at))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSubscriptions(db: Db, userId?: string): Promise<SubscriptionRow[]> {
  const conds = [];
  if (userId) conds.push(eq(subscriptions.user_id, userId));
  return db
    .select()
    .from(subscriptions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(subscriptions.created_at));
}

export async function listActiveSubscriptions(db: Db): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"))
    .orderBy(desc(subscriptions.created_at));
}

export async function updateSubscription(
  db: Db,
  id: string,
  s: { status?: "active" | "cancelled" | "expired"; planId?: string; endsAt?: number | null },
) {
  const sets: Record<string, unknown> = { updated_at: Date.now() };
  if (s.status !== undefined) sets.status = s.status;
  if (s.planId !== undefined) sets.plan_id = s.planId;
  if (s.endsAt !== undefined) sets.ends_at = s.endsAt;
  if (Object.keys(sets).length === 1) return;
  await db.update(subscriptions).set(sets).where(eq(subscriptions.id, id));
}

// ── Invoices ───────────────────────────────────────

export async function createInvoice(
  db: Db,
  inv: {
    id: string;
    userId: string;
    subscriptionId: string;
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
  opts: { userId?: string; subscriptionId?: string; limit?: number; offset?: number } = {},
): Promise<InvoiceRow[]> {
  const conds = [];
  if (opts.userId) conds.push(eq(invoices.user_id, opts.userId));
  if (opts.subscriptionId) conds.push(eq(invoices.subscription_id, opts.subscriptionId));
  return db
    .select()
    .from(invoices)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(invoices.created_at))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function listPendingInvoices(db: Db, before: number): Promise<InvoiceRow[]> {
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.status, "pending"), lt(invoices.period_end, before)))
    .orderBy(desc(invoices.created_at));
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
