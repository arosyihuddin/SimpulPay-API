import { eq, and, desc, sql } from "drizzle-orm";
import { announcements } from "../schema";
import type { Db } from "../client";

export type AnnouncementRow = typeof announcements.$inferSelect;

export async function createAnnouncement(
  db: Db,
  a: { title: string; message: string; type?: string; active?: boolean },
) {
  await db.insert(announcements).values({
    title: a.title,
    message: a.message,
    type: a.type ?? "info",
    active: a.active ?? true,
    created_at: Date.now(),
  });
}

export async function listAnnouncements(
  db: Db,
  opts: { onlyActive?: boolean; limit?: number; offset?: number } = {},
): Promise<AnnouncementRow[]> {
  const conds = [];
  if (opts.onlyActive) conds.push(eq(announcements.active, true));
  return db
    .select()
    .from(announcements)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(announcements.created_at))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function getAnnouncement(db: Db, id: number): Promise<AnnouncementRow | null> {
  const rows = await db.select().from(announcements).where(eq(announcements.id, id));
  return rows[0] ?? null;
}

export async function updateAnnouncement(
  db: Db,
  id: number,
  a: { title?: string; message?: string; type?: string; active?: boolean },
) {
  const sets: Record<string, unknown> = {};
  if (a.title !== undefined) sets.title = a.title;
  if (a.message !== undefined) sets.message = a.message;
  if (a.type !== undefined) sets.type = a.type;
  if (a.active !== undefined) sets.active = a.active;
  if (Object.keys(sets).length === 0) return;
  await db.update(announcements).set(sets).where(eq(announcements.id, id));
}

export async function deleteAnnouncement(db: Db, id: number) {
  await db.delete(announcements).where(eq(announcements.id, id));
}

export async function countAnnouncements(db: Db, onlyActive = false): Promise<number> {
  const conds = [];
  if (onlyActive) conds.push(eq(announcements.active, true));
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(announcements)
    .where(conds.length ? and(...conds) : undefined);
  return Number(r[0]?.c ?? 0);
}
