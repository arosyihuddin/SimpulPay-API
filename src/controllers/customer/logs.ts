import { recentLogsByUser, countLogsByUser } from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { currentUserId } from "./helpers";

export async function listLogsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "100", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  return c.json({
    success: true,
    data: {
      logs: await recentLogsByUser(DB, userId, limit, offset),
      total: await countLogsByUser(DB, userId),
    },
  });
}
