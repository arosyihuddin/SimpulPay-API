import { eq, desc, sql, and } from "drizzle-orm";
import {
  merchants,
  transactions,
  claims,
  apiKeys,
  notifications,
} from "../schema";
import type { Db } from "../client";

export type MerchantRow = typeof merchants.$inferSelect;

export async function createMerchant(
  db: Db,
  m: {
    id: string;
    userId: string;
    name: string;
    type?: "gopay" | "shopeepay";
    gopayMerchantId?: string | null;
    qrisStatic?: string | null;
  },
) {
  const now = Date.now();
  await db.insert(merchants).values({
    id: m.id,
    user_id: m.userId,
    type: m.type ?? "gopay",
    name: m.name,
    merchant_id: m.gopayMerchantId ?? null,
    qris_static: m.qrisStatic ?? null,
    config_json: null,
    status: "active",
    created_at: now,
    updated_at: now,
  });
}

export async function getMerchant(
  db: Db,
  id: string,
): Promise<MerchantRow | null> {
  const rows = await db.select().from(merchants).where(eq(merchants.id, id));
  return rows[0] ?? null;
}

export async function countMerchantsByUser(
  db: Db,
  userId: string,
): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(merchants)
    .where(eq(merchants.user_id, userId));
  return Number(r[0]?.c ?? 0);
}

export async function listMerchantsByUser(
  db: Db,
  userId: string,
): Promise<MerchantRow[]> {
  return db
    .select()
    .from(merchants)
    .where(eq(merchants.user_id, userId))
    .orderBy(desc(merchants.created_at));
}

export async function getMerchantByUser(
  db: Db,
  userId: string,
  merchantId?: string | null,
): Promise<MerchantRow | null> {
  const cond = merchantId
    ? and(eq(merchants.user_id, userId), eq(merchants.id, merchantId))
    : eq(merchants.user_id, userId);
  const rows = await db.select().from(merchants).where(cond).limit(1);
  return rows[0] ?? null;
}

/** Cari merchant milik user berdasarkan merchant_id (G9...) — dipakai resolve dari hasil parse QRIS. */
export async function getMerchantByGopayId(
  db: Db,
  userId: string,
  gopayId: string,
): Promise<MerchantRow | null> {
  const rows = await db
    .select()
    .from(merchants)
    .where(
      and(
        eq(merchants.user_id, userId),
        eq(merchants.merchant_id, gopayId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function updateMerchant(
  db: Db,
  id: string,
  u: {
    name?: string;
    type?: "gopay" | "shopeepay";
    gopayMerchantId?: string | null;
    qrisStatic?: string | null;
    status?: string;
    configJson?: string | null;
  },
) {
  const now = Date.now();
  const sets: Record<string, unknown> = { updated_at: now };
  if (u.name !== undefined) sets.name = u.name;
  if (u.type !== undefined) sets.type = u.type;
  if (u.gopayMerchantId !== undefined)
    sets.merchant_id = u.gopayMerchantId;
  if (u.qrisStatic !== undefined) sets.qris_static = u.qrisStatic;
  if (u.status !== undefined) sets.status = u.status;
  if (u.configJson !== undefined) sets.config_json = u.configJson;
  if (Object.keys(sets).length === 1) return;
  await db.update(merchants).set(sets).where(eq(merchants.id, id));
}

export async function saveGoBizSession(
  db: Db,
  merchantId: string,
  data: Record<string, unknown>,
) {
  await db
    .update(merchants)
    .set({ config_json: data as never })
    .where(eq(merchants.id, merchantId));
}

export async function loadGoBizSession(
  db: Db,
  merchantId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ data: merchants.config_json })
    .from(merchants)
    .where(eq(merchants.id, merchantId));
  return (rows[0]?.data as Record<string, unknown> | null) ?? null;
}

export async function deleteGoBizSession(db: Db, merchantId: string) {
  await db
    .update(merchants)
    .set({ config_json: null })
    .where(eq(merchants.id, merchantId));
}

export async function deleteMerchant(db: Db, id: string) {
  await db.delete(claims).where(eq(claims.merchant_id, id));
  await db.delete(transactions).where(eq(transactions.merchant_id, id));
  await db.delete(apiKeys).where(eq(apiKeys.merchant_id, id));
  await db.delete(notifications).where(eq(notifications.merchant_id, id));
  await db.delete(merchants).where(eq(merchants.id, id));
}

export async function listAllMerchants(db: Db): Promise<MerchantRow[]> {
  return db.select().from(merchants).orderBy(desc(merchants.created_at));
}
