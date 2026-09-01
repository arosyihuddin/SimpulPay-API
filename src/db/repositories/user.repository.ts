import { eq, or, desc, sql, ilike } from "drizzle-orm";
import { users } from "../schema";
import type { Db } from "../client";

export type UserRow = typeof users.$inferSelect;

export async function listUsers(
  db: Db,
  opts: { limit?: number; offset?: number; q?: string } = {},
): Promise<UserRow[]> {
  const { limit = 50, offset = 0, q } = opts;
  const where = q
    ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`))
    : undefined;
  return db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.created_at))
    .limit(limit)
    .offset(offset);
}

export async function countUsers(db: Db, q?: string): Promise<number> {
  const where = q
    ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`))
    : undefined;
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(where);
  return Number(r[0]?.c ?? 0);
}

export async function getUserById(db: Db, id: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}

export async function getUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.email, email));
  return rows[0] ?? null;
}

export async function createUser(
  db: Db,
  u: {
    id: string;
    email: string;
    passwordHash: string;
    role?: "admin" | "customer";
    status?: "active" | "suspended" | "banned";
  },
) {
  const now = Date.now();
  await db.insert(users).values({
    id: u.id,
    email: u.email,
    password_hash: u.passwordHash,
    role: u.role ?? "admin",
    status: u.status ?? "active",
    created_at: now,
    updated_at: now,
  });
}

export async function updateUser(
  db: Db,
  id: string,
  u: { email?: string; name?: string | null; phone?: string | null; role?: "admin" | "customer"; passwordHash?: string; status?: "active" | "suspended" | "banned" },
) {
  const now = Date.now();
  const sets: Record<string, unknown> = { updated_at: now };
  if (u.email !== undefined) sets.email = u.email;
  if (u.name !== undefined) sets.name = u.name;
  if (u.phone !== undefined) sets.phone = u.phone;
  if (u.role !== undefined) sets.role = u.role;
  if (u.passwordHash !== undefined) sets.password_hash = u.passwordHash;
  if (u.status !== undefined) sets.status = u.status;
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
