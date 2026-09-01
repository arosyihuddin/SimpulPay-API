import {
  listAnnouncements,
  countAnnouncements,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";

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
