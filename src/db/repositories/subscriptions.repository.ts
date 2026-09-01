import { eq, and, or, desc, lt, gte, lte, ne, isNull, sql, ilike } from "drizzle-orm";
import { subscriptions, plans, users } from "../schema";
import type { Db } from "../client";
import type { PlanRow } from "./plans.repository";

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export async function createSubscription(
  db: Db,
  s: {
    id: string;
    userId: string;
    planId: string;
    status?: "active" | "pending" | "cancelled" | "expired";
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

export async function getSubscription(
  db: Db,
  id: string,
): Promise<SubscriptionRow | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id));
  return rows[0] ?? null;
}

export async function getActiveSubscription(
  db: Db,
  userId: string,
): Promise<SubscriptionRow | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.user_id, userId),
        eq(subscriptions.status, "active"),
        or(
          isNull(subscriptions.ends_at),
          gte(subscriptions.ends_at, Date.now()),
        ),
      ),
    )
    .orderBy(desc(subscriptions.created_at))
    .limit(1);
  return rows[0] ?? null;
}

/** Sub pending paling baru untuk user (upgrade yang belum lunas). */
export async function getPendingSubscription(
  db: Db,
  userId: string,
): Promise<SubscriptionRow | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.user_id, userId),
        eq(subscriptions.status, "pending"),
      ),
    )
    .orderBy(desc(subscriptions.created_at))
    .limit(1);
  return rows[0] ?? null;
}

/** Sub pending yang belum lunas lewat batas waktu (created_at sebelum `olderThanMs`). */
export async function listStalePendingSubscriptions(
  db: Db,
  olderThanMs: number,
): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "pending"),
        lt(subscriptions.created_at, olderThanMs),
      ),
    );
}

/** Sub aktif + plan-nya dalam 1 query (join). Ganti getActiveSubscription+getPlan kalau dua-duanya dipakai. */
export async function getActivePlanForUser(
  db: Db,
  userId: string,
): Promise<{ plan: PlanRow; subscription: SubscriptionRow } | null> {
  const rows = await db
    .select({ plan: plans, subscription: subscriptions })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.plan_id))
    .where(
      and(
        eq(subscriptions.user_id, userId),
        eq(subscriptions.status, "active"),
        or(
          isNull(subscriptions.ends_at),
          gte(subscriptions.ends_at, Date.now()),
        ),
      ),
    )
    .orderBy(desc(subscriptions.created_at))
    .limit(1);
  return rows[0] ?? null;
}

export type SubscriptionWithUser = SubscriptionRow & {
  user_name: string | null;
  user_email: string | null;
  plan_type: string | null;
  plan_name: string | null;
};

type SubFilter = {
  userId?: string;
  status?: "active" | "pending" | "cancelled" | "expired";
  startFrom?: number;
  startTo?: number;
  endFrom?: number;
  endTo?: number;
  includeFree?: boolean;
  q?: string;
};

function subConds(o: SubFilter) {
  const conds = [];
  if (o.userId) conds.push(eq(subscriptions.user_id, o.userId));
  if (o.status) conds.push(eq(subscriptions.status, o.status));
  if (o.q) {
    const like = `%${o.q}%`;
    conds.push(or(ilike(users.name, like), ilike(users.email, like)));
  }
  if (o.startFrom !== undefined)
    conds.push(gte(subscriptions.starts_at, o.startFrom));
  if (o.startTo !== undefined)
    conds.push(lte(subscriptions.starts_at, o.startTo));
  if (o.endFrom !== undefined)
    conds.push(gte(subscriptions.ends_at, o.endFrom));
  if (o.endTo !== undefined) conds.push(lte(subscriptions.ends_at, o.endTo));
  if (!o.includeFree) conds.push(ne(plans.type, "free"));
  return conds;
}

/** Semua sub + data user + plan type via join. Dipakai admin list. */
export async function listSubscriptions(
  db: Db,
  o: SubFilter & { limit?: number; offset?: number } = {},
): Promise<SubscriptionWithUser[]> {
  const rows = await db
    .select({ s: subscriptions, u: users, p: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.plan_id))
    .leftJoin(users, eq(users.id, subscriptions.user_id))
    .where(subConds(o).length ? and(...subConds(o)) : undefined)
    .orderBy(desc(subscriptions.created_at))
    .limit(o.limit ?? 50)
    .offset(o.offset ?? 0);
  return rows.map(({ s, u, p }) => ({
    ...s,
    user_name: u?.name ?? null,
    user_email: u?.email ?? null,
    plan_type: p?.type ?? null,
    plan_name: p?.name ?? null,
  }));
}

/** Total + count per status dalam 1 query (status filter user diabaikan — hitungan global). */
export async function countSubscriptionsByStatus(
  db: Db,
  o: SubFilter = {},
): Promise<{ total: number; active: number; cancelled: number; expired: number }> {
  const { status: _ignored, ...base } = o;
  const conds = subConds(base);
  const r = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${subscriptions.status} = 'active')::int`,
      cancelled: sql<number>`count(*) filter (where ${subscriptions.status} = 'cancelled')::int`,
      expired: sql<number>`count(*) filter (where ${subscriptions.status} = 'expired')::int`,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.plan_id))
    .leftJoin(users, eq(users.id, subscriptions.user_id))
    .where(conds.length ? and(...conds) : undefined);
  return r[0] ?? { total: 0, active: 0, cancelled: 0, expired: 0 };
}

/** Sub status active tapi ends_at sudah lewat — kandidat expired. */
export async function listExpiredSubscriptions(
  db: Db,
  now = Date.now(),
): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(subscriptions)
    .where(
      and(eq(subscriptions.status, "active"), lt(subscriptions.ends_at, now)),
    )
    .orderBy(desc(subscriptions.created_at));
}

export async function updateSubscription(
  db: Db,
  id: string,
  s: {
    status?: "active" | "pending" | "cancelled" | "expired";
    planId?: string;
    endsAt?: number | null;
  },
) {
  const sets: Record<string, unknown> = { updated_at: Date.now() };
  if (s.status !== undefined) sets.status = s.status;
  if (s.planId !== undefined) sets.plan_id = s.planId;
  if (s.endsAt !== undefined) sets.ends_at = s.endsAt;
  if (Object.keys(sets).length === 1) return;
  await db.update(subscriptions).set(sets).where(eq(subscriptions.id, id));
}

/**
 * Bayar pending sub → aktif: cancel sub aktif lain milik user, aktifkan subId.
 * Dipakai verifikasi payment otomatis (customer) + mark paid manual (admin).
 */
export async function activateSubscriptionSwap(
  db: Db,
  subId: string,
  userId: string,
  endsAt: number,
) {
  const actives = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.user_id, userId),
        eq(subscriptions.status, "active"),
      ),
    );
  for (const a of actives) {
    if (a.id !== subId) {
      await db
        .update(subscriptions)
        .set({ status: "cancelled", updated_at: Date.now() })
        .where(eq(subscriptions.id, a.id));
    }
  }
  await db
    .update(subscriptions)
    .set({ status: "active", ends_at: endsAt, updated_at: Date.now() })
    .where(eq(subscriptions.id, subId));
}
