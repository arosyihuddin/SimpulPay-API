import { eq } from "drizzle-orm";
import { gobizSessions } from "../schema";
import type { Db } from "../client";

export async function saveGoBizSession(db: Db, merchantId: string, data: Record<string, unknown>) {
  await db
    .insert(gobizSessions)
    .values({ merchant_id: merchantId, data: JSON.stringify(data), updated_at: Date.now() })
    .onConflictDoUpdate({
      target: gobizSessions.merchant_id,
      set: { data: JSON.stringify(data), updated_at: Date.now() },
    });
}

export async function loadGoBizSession(db: Db, merchantId: string): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ data: gobizSessions.data })
    .from(gobizSessions)
    .where(eq(gobizSessions.merchant_id, merchantId));
  if (!rows[0]?.data) return null;
  try {
    return JSON.parse(rows[0].data);
  } catch {
    return null;
  }
}

export async function deleteGoBizSession(db: Db, merchantId: string) {
  await db.delete(gobizSessions).where(eq(gobizSessions.merchant_id, merchantId));
}
