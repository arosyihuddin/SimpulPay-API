import { eq, lt } from "drizzle-orm";
import { adminSessions } from "../schema";
import type { Db } from "../client";

export async function createAdminSession(db: Db, token: string, ttlMs: number, userId?: string) {
  const now = Date.now();
  await db.insert(adminSessions).values({
    token,
    user_id: userId ?? null,
    created_at: now,
    expires_at: now + ttlMs,
  });
}

export async function getAdminSession(
  db: Db,
  token: string,
): Promise<typeof adminSessions.$inferSelect | null> {
  const rows = await db.select().from(adminSessions).where(eq(adminSessions.token, token));
  return rows[0] ?? null;
}

export async function deleteAdminSession(db: Db, token: string) {
  await db.delete(adminSessions).where(eq(adminSessions.token, token));
}

export async function cleanExpiredSessions(db: Db, now = Date.now()) {
  await db.delete(adminSessions).where(lt(adminSessions.expires_at, now));
}
