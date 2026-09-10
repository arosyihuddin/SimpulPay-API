import { eq, and, desc, sql } from "drizzle-orm";
import { notifications } from "../schema";
import type { Db } from "../client";

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationType = typeof notifications.$inferSelect.type;

export async function insertNotification(
  db: Db,
  n: { userId: string; merchantId?: string | null; type: NotificationType; title: string; message: string; dataJson?: string | null },
) {
  await db.insert(notifications).values({
    user_id: n.userId,
    merchant_id: n.merchantId ?? null,
    type: n.type,
    title: n.title,
    message: n.message,
    data_json: n.dataJson ?? null,
    read: false,
    created_at: Date.now(),
  });
}

export async function listNotificationsByUser(
  db: Db,
  userId: string,
  opts: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
): Promise<NotificationRow[]> {
  const conds = [eq(notifications.user_id, userId)];
  if (opts.unreadOnly) conds.push(eq(notifications.read, false));
  return db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.created_at))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function markNotificationRead(db: Db, id: number, userId: string) {
  await db.update(notifications).set({ read: true }).where(and(eq(notifications.id, id), eq(notifications.user_id, userId)));
}

export async function markAllNotificationsRead(db: Db, userId: string) {
  await db.update(notifications).set({ read: true }).where(and(eq(notifications.user_id, userId), eq(notifications.read, false)));
}

export async function countUnreadNotifications(db: Db, userId: string): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.user_id, userId), eq(notifications.read, false)));
  return Number(r[0]?.c ?? 0);
}
