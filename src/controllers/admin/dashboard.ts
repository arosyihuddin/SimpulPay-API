import { recentLogs, countLogs } from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";

export async function listLogs(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "100", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  return c.json({ success: true, data: { logs: await recentLogs(DB, limit, offset), total: await countLogs(DB) } });
}
