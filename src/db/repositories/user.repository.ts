import { eq, desc, sql } from "drizzle-orm";
import { users } from "../schema";
import type { Db } from "../client";

export type UserRow = typeof users.$inferSelect;

export async function listUsers(db: Db, limit = 50, offset = 0): Promise<UserRow[]> {
  return db
    .select()
    .from(users)
    .orderBy(desc(users.created_at))
    .limit(limit)
    .offset(offset);
}

export async function countUsers(db: Db): Promise<number> {
  const r = await db.select({ c: sql<number>`count(*)::int` }).from(users);
  return Number(r[0]?.c ?? 0);
}

export async function getUserById(db: Db, id: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}

export async function getUserByUsername(db: Db, username: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.username, username));
  return rows[0] ?? null;
}

export async function createUser(
  db: Db,
  u: { id: string; username: string; passwordHash: string; role?: string },
) {
  const now = Date.now();
  await db.insert(users).values({
    id: u.id,
    username: u.username,
    password_hash: u.passwordHash,
    role: u.role ?? "admin",
    created_at: now,
    updated_at: now,
  });
}

export async function updateUser(
  db: Db,
  id: string,
  u: { username?: string; role?: string; passwordHash?: string },
) {
  const now = Date.now();
  const sets: Record<string, unknown> = { updated_at: now };
  if (u.username !== undefined) sets.username = u.username;
  if (u.role !== undefined) sets.role = u.role;
  if (u.passwordHash !== undefined) sets.password_hash = u.passwordHash;
  if (Object.keys(sets).length === 1) return; // hanya updated_at — tak ada yang diubah
  await db.update(users).set(sets).where(eq(users.id, id));
}

export async function updateUserPassword(db: Db, id: string, passwordHash: string) {
  await db
    .update(users)
    .set({ password_hash: passwordHash, updated_at: Date.now() })
    .where(eq(users.id, id));
}

export async function deleteUser(db: Db, id: string) {
  await db.delete(users).where(eq(users.id, id));
}
