import {
  listAnnouncements,
  countAnnouncements,
  getReadAnnouncementIds,
  markAnnouncementRead,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId } from "./helpers";

export async function listAnnouncementsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  const onlyActive = q.active === "1" || q.active === "true";
  const userId = currentUserId(c);
  const items = await listAnnouncements(DB, { onlyActive, limit, offset });
  const readIds = await getReadAnnouncementIds(DB, userId);
  return c.json({
    success: true,
    data: {
      announcements: items.map((a) => ({ ...a, read: readIds.has(a.id) })),
      total: await countAnnouncements(DB, onlyActive),
    },
  });
}

/** Dismiss/hide banner announcement — per user. */
export async function markAnnouncementReadCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (isNaN(id)) bad("ID announcement tidak valid");
  await markAnnouncementRead(DB, id, userId);
  return c.json({ success: true });
}
