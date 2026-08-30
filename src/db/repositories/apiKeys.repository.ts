import { eq, desc } from "drizzle-orm";
import { apiKeys } from "../schema";
import type { Db } from "../client";

export type ApiKeyRow = typeof apiKeys.$inferSelect;

export async function createApiKey(
  db: Db,
  k: { id: string; userId: string; key: string; label?: string | null },
) {
  await db.insert(apiKeys).values({
    id: k.id,
    user_id: k.userId,
    key: k.key,
    label: k.label ?? null,
    status: "active",
    last_used_at: null,
    created_at: Date.now(),
  });
}

export async function getApiKeyByKey(db: Db, key: string): Promise<ApiKeyRow | null> {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.key, key));
  return rows[0] ?? null;
}

export async function listApiKeysByUser(db: Db, userId: string): Promise<ApiKeyRow[]> {
  return db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.user_id, userId))
    .orderBy(desc(apiKeys.created_at));
}

export async function updateApiKey(
  db: Db,
  id: string,
  u: { label?: string; status?: string; lastUsedAt?: number },
) {
  const sets: Record<string, unknown> = {};
  if (u.label !== undefined) sets.label = u.label;
  if (u.status !== undefined) sets.status = u.status;
  if (u.lastUsedAt !== undefined) sets.last_used_at = u.lastUsedAt;
  if (Object.keys(sets).length === 0) return;
  await db.update(apiKeys).set(sets).where(eq(apiKeys.id, id));
}

export async function deleteApiKey(db: Db, id: string) {
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
}
