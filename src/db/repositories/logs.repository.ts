import { eq, desc, notInArray, sql } from "drizzle-orm";
import { logs } from "../schema";
import type { Db } from "../client";

export type LogRow = typeof logs.$inferSelect;

export async function insertLog(db: Db, type: string, message: string, details: unknown = null, userId?: string | null) {
  const detailsJson = details === null ? null : JSON.stringify(details);
  await db.insert(logs).values({
    timestamp: String(Date.now()),
    type,
    message,
    details_json: detailsJson,
    user_id: userId ?? null,
  });
  await db
    .delete(logs)
    .where(
      notInArray(
        logs.id,
        db.select({ id: logs.id }).from(logs).orderBy(desc(logs.id)).limit(500),
      ),
    );
}

export async function recentLogs(db: Db, limit = 100, offset = 0): Promise<LogRow[]> {
  return db
    .select()
    .from(logs)
    .orderBy(desc(logs.id))
    .limit(limit)
    .offset(offset);
}

export async function recentLogsByUser(db: Db, userId: string, limit = 100, offset = 0): Promise<LogRow[]> {
  return db
    .select()
    .from(logs)
    .where(eq(logs.user_id, userId))
    .orderBy(desc(logs.id))
    .limit(limit)
    .offset(offset);
}

export async function countLogsByUser(db: Db, userId: string): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(logs)
    .where(eq(logs.user_id, userId));
  return Number(r[0]?.c ?? 0);
}
