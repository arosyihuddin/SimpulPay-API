import { eq } from "drizzle-orm";
import { announcementReads } from "../schema";
import type { Db } from "../client";

/** Tandai announcement sebagai dibaca/dismiss user. Upsert: safe di-repeat. */
export async function markAnnouncementRead(
  db: Db,
  announcementId: number,
  userId: string,
) {
  await db
    .insert(announcementReads)
    .values({
      announcement_id: announcementId,
      user_id: userId,
      read_at: Date.now(),
    })
    .onConflictDoNothing();
}

/** Set announcement_id yang sudah dibaca user (untuk filter di list). */
export async function getReadAnnouncementIds(
  db: Db,
  userId: string,
): Promise<Set<number>> {
  const rows = await db
    .select({ id: announcementReads.announcement_id })
    .from(announcementReads)
    .where(eq(announcementReads.user_id, userId));
  return new Set(rows.map((r) => r.id));
}

/** Hapus semua read-record untuk announcement (dipakai pas delete announcement). */
export async function deleteAnnouncementReads(
  db: Db,
  announcementId: number,
) {
  await db
    .delete(announcementReads)
    .where(eq(announcementReads.announcement_id, announcementId));
}

/** Hapus semua read-record announcement milik user (dipakai pas delete user). */
export async function deleteAnnouncementReadsByUser(db: Db, userId: string) {
  await db
    .delete(announcementReads)
    .where(eq(announcementReads.user_id, userId));
}
