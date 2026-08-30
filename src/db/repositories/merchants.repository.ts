import { eq, desc } from "drizzle-orm";
import { merchants } from "../schema";
import type { Db } from "../client";

export type MerchantRow = typeof merchants.$inferSelect;

export async function createMerchant(
  db: Db,
  m: { id: string; userId: string; name: string; type?: "gopay" | "shopeepay"; gopayMerchantId?: string | null; qrisStatic?: string | null },
) {
  const now = Date.now();
  await db.insert(merchants).values({
    id: m.id,
    user_id: m.userId,
    type: m.type ?? "gopay",
    name: m.name,
    gopay_merchant_id: m.gopayMerchantId ?? null,
    qris_static: m.qrisStatic ?? null,
    config_json: null,
    status: "active",
    created_at: now,
    updated_at: now,
  });
}

export async function getMerchant(db: Db, id: string): Promise<MerchantRow | null> {
  const rows = await db.select().from(merchants).where(eq(merchants.id, id));
  return rows[0] ?? null;
}

export async function listMerchantsByUser(db: Db, userId: string): Promise<MerchantRow[]> {
  return db
    .select()
    .from(merchants)
    .where(eq(merchants.user_id, userId))
    .orderBy(desc(merchants.created_at));
}

export async function getMerchantByUser(db: Db, userId: string): Promise<MerchantRow | null> {
  const rows = await db
    .select()
    .from(merchants)
    .where(eq(merchants.user_id, userId))
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
  if (u.gopayMerchantId !== undefined) sets.gopay_merchant_id = u.gopayMerchantId;
  if (u.qrisStatic !== undefined) sets.qris_static = u.qrisStatic;
  if (u.status !== undefined) sets.status = u.status;
  if (u.configJson !== undefined) sets.config_json = u.configJson;
  if (Object.keys(sets).length === 1) return;
  await db.update(merchants).set(sets).where(eq(merchants.id, id));
}

export async function deleteMerchant(db: Db, id: string) {
  await db.delete(merchants).where(eq(merchants.id, id));
}

export async function listAllMerchants(db: Db): Promise<MerchantRow[]> {
  return db.select().from(merchants).orderBy(desc(merchants.created_at));
}
