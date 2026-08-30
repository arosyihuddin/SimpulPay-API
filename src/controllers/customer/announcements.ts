import {
  listAnnouncements,
  getAnnouncement,
  countAnnouncements,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad } from "./helpers";

export async function listAnnouncementsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  const onlyActive = q.active === "1" || q.active === "true";
  const items = await listAnnouncements(DB, { onlyActive, limit, offset });
  return c.json({
    success: true,
    data: { announcements: items, total: await countAnnouncements(DB, onlyActive) },
  });
}

export async function getAnnouncementCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (isNaN(id)) bad("ID pengumuman tidak valid");
  const a = await getAnnouncement(DB, id);
  if (!a) bad("Pengumuman tidak ditemukan", 404);
  return c.json({ success: true, data: a });
}
