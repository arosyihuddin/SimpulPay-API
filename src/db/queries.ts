import { eq, and, lt, desc, sql, notInArray } from "drizzle-orm";
import { qris, claims, logs, settings, adminSessions, gobizSessions } from "./schema";
import type { Db } from "./client";

export type QrisRow = typeof qris.$inferSelect;
export type LogRow = typeof logs.$inferSelect;

export async function insertQRIS(
  db: Db,
  r: {
    id: string;
    code: string;
    amount: number;
    baseAmount: number;
    uniqueCode: number;
    trxId: string;
    createdAt: number;
    expiresAt: number;
  },
) {
  await db.insert(qris).values({
    id: r.id,
    code: r.code,
    amount: r.amount,
    base_amount: r.baseAmount,
    unique_code: r.uniqueCode,
    trx_id: r.trxId,
    status: "PENDING",
    created_at: r.createdAt,
    expires_at: r.expiresAt,
  });
}

export async function getQRIS(db: Db, id: string): Promise<QrisRow | null> {
  const rows = await db.select().from(qris).where(eq(qris.id, id));
  return rows[0] ?? null;
}

export async function listQRIS(db: Db, limit = 50, offset = 0): Promise<QrisRow[]> {
  return db
    .select()
    .from(qris)
    .orderBy(desc(qris.created_at))
    .limit(limit)
    .offset(offset);
}

export async function countQRIS(db: Db): Promise<number> {
  const r = await db.select({ c: sql<number>`count(*)::int` }).from(qris);
  return Number(r[0]?.c ?? 0);
}

export async function markQRISPaid(db: Db, id: string, transactionJson: string) {
  await db
    .update(qris)
    .set({ status: "PAID", transaction_json: transactionJson })
    .where(eq(qris.id, id));
}

export async function markQRISExpired(db: Db, now = Date.now()) {
  await db
    .update(qris)
    .set({ status: "EXPIRED" })
    .where(and(eq(qris.status, "PENDING"), lt(qris.expires_at, now)));
}

export async function claimTx(
  db: Db,
  txId: string,
  qrisId: string | null,
  claimedAt = Date.now(),
): Promise<boolean> {
  const rows = await db
    .insert(claims)
    .values({ tx_id: txId, qris_id: qrisId, claimed_at: claimedAt })
    .onConflictDoNothing({ target: claims.tx_id })
    .returning({ tx_id: claims.tx_id });
  return rows.length > 0;
}

export async function getClaim(db: Db, txId: string): Promise<typeof claims.$inferSelect | null> {
  const rows = await db.select().from(claims).where(eq(claims.tx_id, txId));
  return rows[0] ?? null;
}

export async function cleanOldClaims(db: Db, before = Date.now() - 24 * 60 * 60 * 1000) {
  await db.delete(claims).where(lt(claims.claimed_at, before));
}

export async function insertLog(db: Db, type: string, message: string, details: unknown = null) {
  const detailsJson = details === null ? null : JSON.stringify(details);
  await db.insert(logs).values({
    timestamp: new Date().toISOString(),
    type,
    message,
    details_json: detailsJson,
  });
  // Retensi: hapus log di luar 500 terbaru.
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

export async function countLogs(db: Db): Promise<number> {
  const r = await db.select({ c: sql<number>`count(*)::int` }).from(logs);
  return Number(r[0]?.c ?? 0);
}

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  return rows[0]?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updated_at: Date.now() },
    });
}

export async function createAdminSession(db: Db, token: string, ttlMs: number, userId?: string) {
  const now = Date.now();
  await db.insert(adminSessions).values({
    token,
    user_id: userId ?? null,
    created_at: now,
    expires_at: now + ttlMs,
  });
}

export async function getAdminSession(
  db: Db,
  token: string,
): Promise<typeof adminSessions.$inferSelect | null> {
  const rows = await db.select().from(adminSessions).where(eq(adminSessions.token, token));
  return rows[0] ?? null;
}

export async function deleteAdminSession(db: Db, token: string) {
  await db.delete(adminSessions).where(eq(adminSessions.token, token));
}

export async function cleanExpiredSessions(db: Db, now = Date.now()) {
  await db.delete(adminSessions).where(lt(adminSessions.expires_at, now));
}

export async function saveGoBizSession(db: Db, data: Record<string, unknown>) {
  await db
    .insert(gobizSessions)
    .values({ id: 1, data: JSON.stringify(data), updated_at: Date.now() })
    .onConflictDoUpdate({
      target: gobizSessions.id,
      set: { data: JSON.stringify(data), updated_at: Date.now() },
    });
}

export async function loadGoBizSession(db: Db): Promise<Record<string, unknown> | null> {
  const rows = await db.select({ data: gobizSessions.data }).from(gobizSessions).where(eq(gobizSessions.id, 1));
  if (!rows[0]?.data) return null;
  try {
    return JSON.parse(rows[0].data);
  } catch {
    return null;
  }
}

export async function deleteGoBizSession(db: Db) {
  await db.delete(gobizSessions).where(eq(gobizSessions.id, 1));
}
