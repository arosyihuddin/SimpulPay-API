import { listNotificationsByUser, markNotificationRead, markAllNotificationsRead, countUnreadNotifications } from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId } from "./helpers";

export async function listNotificationsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  const unreadOnly = q.unread === "1" || q.unread === "true";
  const userId = currentUserId(c);
  return c.json({
    success: true,
    data: { notifications: await listNotificationsByUser(DB, userId, { limit, offset, unreadOnly }), unread: await countUnreadNotifications(DB, userId) },
  });
}

export async function markNotificationReadCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (isNaN(id)) bad("ID notifikasi tidak valid");
  await markNotificationRead(DB, id, currentUserId(c));
  return c.json({ success: true });
}

export async function markAllNotificationsReadCtl(c: Context<AppEnv>) {
  await markAllNotificationsRead(getDb(c), currentUserId(c));
  return c.json({ success: true });
}