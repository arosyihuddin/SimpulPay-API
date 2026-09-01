import { eq, asc, and } from "drizzle-orm";
import { plans } from "../schema";
import type { Db } from "../client";

export type PlanRow = typeof plans.$inferSelect;

export async function createPlan(
  db: Db,
  p: {
    id: string;
    name: string;
    type?: "free" | "paid";
    price?: number;
    maxMerchants?: number;
    dailyPaidLimit?: number | null;
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
    daily_paid_limit: p.dailyPaidLimit ?? null,
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
    dailyPaidLimit?: number | null;
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
  if (p.dailyPaidLimit !== undefined) sets.daily_paid_limit = p.dailyPaidLimit;
  if (p.featuresJson !== undefined) sets.features_json = p.featuresJson;
  if (p.active !== undefined) sets.active = p.active;
  if (Object.keys(sets).length === 1) return;
  await db.update(plans).set(sets).where(eq(plans.id, id));
}

export async function deletePlan(db: Db, id: string) {
  await db.delete(plans).where(eq(plans.id, id));
}