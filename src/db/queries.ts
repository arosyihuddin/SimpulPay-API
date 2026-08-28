// Query helpers — Drizzle, dual-driver (sqlite sync / postgres async). Semua fungsi async
// supaya signature sama buat kedua driver; await nilai sync sqlite tak ada ongkos.
import { eq, and, lt, sql, desc } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "./schema"; // sqlite tables
import * as pg from "./schema.pg"; // postgres tables
import { db, rawDb } from "./client";
import { broadcast } from "../services/realtime";

const isPg = process.env.DB_DRIVER === "postgres";
const sq = db as BunSQLiteDatabase<typeof s>;
const sp = db as NodePgDatabase<typeof pg>;

export interface QrisRow {
  id: string;
  code: string;
  amount: number;
  base_amount: number;
  unique_code: number;
  trx_id: string;
  status: string;
  transaction_json: string | null;
  created_at: number;
  expires_at: number;
}

export async function insertQRIS(r: {
  id: string;
  code: string;
  amount: number;
  baseAmount: number;
  uniqueCode: number;
  trxId: string;
  createdAt: number;
  expiresAt: number;
}) {
  const values = {
    id: r.id,
    code: r.code,
    amount: r.amount,
    base_amount: r.baseAmount,
    unique_code: r.uniqueCode,
    trx_id: r.trxId,
    status: "PENDING",
    created_at: r.createdAt,
    expires_at: r.expiresAt,
  };
  if (isPg) await sp.insert(pg.qris).values(values as never);
  else sq.insert(s.qris).values(values).run();
}

export async function getQRIS(id: string): Promise<QrisRow | null> {
  if (isPg) {
    const rows = await sp.select().from(pg.qris).where(eq(pg.qris.id, id));
    return (rows[0] as QrisRow | undefined) ?? null;
  }
  return (
    (sq.select().from(s.qris).where(eq(s.qris.id, id)).get() as
      | QrisRow
      | undefined) ?? null
  );
}

export async function listQRIS(limit = 50, offset = 0): Promise<QrisRow[]> {
  if (isPg) {
    return (await sp
      .select()
      .from(pg.qris)
      .orderBy(desc(pg.qris.created_at))
      .limit(limit)
      .offset(offset)) as QrisRow[];
  }
  return sq
    .select()
    .from(s.qris)
    .orderBy(desc(s.qris.created_at))
    .limit(limit)
    .offset(offset)
    .all() as QrisRow[];
}

export async function countQRIS(): Promise<number> {
  if (isPg)
    return (
      (await sp.select({ c: sql<number>`count(*)` }).from(pg.qris))[0]?.c ?? 0
    );
  return (
    sq
      .select({ c: sql<number>`count(*)` })
      .from(s.qris)
      .get()?.c ?? 0
  );
}

export async function markQRISPaid(id: string, transactionJson: string) {
  if (isPg) {
    await sp
      .update(pg.qris)
      .set({ status: "PAID", transaction_json: transactionJson })
      .where(eq(pg.qris.id, id));
  } else {
    sq.update(s.qris)
      .set({ status: "PAID", transaction_json: transactionJson })
      .where(eq(s.qris.id, id))
      .run();
  }
  const data = { id, status: "PAID", transaction_json: transactionJson };
  broadcast({ type: "qris_paid", scope: `qr:${id}`, data });
  broadcast({ type: "qris_status", scope: "admin", data });
}

export async function markQRISExpired(now = Date.now()) {
  if (isPg) {
    await sp
      .update(pg.qris)
      .set({ status: "EXPIRED" })
      .where(and(eq(pg.qris.status, "PENDING"), lt(pg.qris.expires_at, now)));
  } else {
    sq.update(s.qris)
      .set({ status: "EXPIRED" })
      .where(and(eq(s.qris.status, "PENDING"), lt(s.qris.expires_at, now)))
      .run();
  }
}

export async function claimTx(
  txId: string,
  qrisId: string | null,
  claimedAt = Date.now(),
): Promise<boolean> {
  if (isPg) {
    const rows = await sp
      .insert(pg.claims)
      .values({ tx_id: txId, qris_id: qrisId, claimed_at: claimedAt } as never)
      .onConflictDoNothing()
      .returning({ tx_id: pg.claims.tx_id });
    return rows.length > 0;
  }
  // sqlite: rawDb kenal `changes` (Drizzle .run() void)
  const res = rawDb!
    .query(
      "INSERT OR IGNORE INTO claims (tx_id, qris_id, claimed_at) VALUES (?, ?, ?)",
    )
    .run(txId, qrisId, claimedAt);
  return res.changes > 0;
}

export async function getClaim(txId: string): Promise<{
  tx_id: string;
  qris_id: string | null;
  claimed_at: number;
} | null> {
  if (isPg) {
    const rows = await sp
      .select()
      .from(pg.claims)
      .where(eq(pg.claims.tx_id, txId));
    return (
      (rows[0] as
        | { tx_id: string; qris_id: string | null; claimed_at: number }
        | undefined) ?? null
    );
  }
  return sq.select().from(s.claims).where(eq(s.claims.tx_id, txId)).get() as {
    tx_id: string;
    qris_id: string | null;
    claimed_at: number;
  } | null;
}

export async function cleanOldClaims(
  before = Date.now() - 24 * 60 * 60 * 1000,
) {
  if (isPg) await sp.delete(pg.claims).where(lt(pg.claims.claimed_at, before));
  else sq.delete(s.claims).where(lt(s.claims.claimed_at, before)).run();
}

export interface LogRow {
  id: number;
  timestamp: string;
  type: string;
  message: string;
  details_json: string | null;
}

export async function insertLog(
  type: string,
  message: string,
  details: unknown = null,
) {
  const detailsJson = details === null ? null : JSON.stringify(details);
  const capSql = sql`id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)`;
  if (isPg) {
    await sp.insert(pg.logs).values({
      timestamp: new Date().toISOString(),
      type,
      message,
      details_json: detailsJson,
    });
    await sp.delete(pg.logs).where(capSql);
  } else {
    sq.insert(s.logs)
      .values({
        timestamp: new Date().toISOString(),
        type,
        message,
        details_json: detailsJson,
      })
      .run();
    sq.delete(s.logs).where(capSql).run();
  }
}

export async function recentLogs(limit = 100, offset = 0): Promise<LogRow[]> {
  if (isPg)
    return (await sp
      .select()
      .from(pg.logs)
      .orderBy(desc(pg.logs.id))
      .limit(limit)
      .offset(offset)) as LogRow[];
  return sq
    .select()
    .from(s.logs)
    .orderBy(desc(s.logs.id))
    .limit(limit)
    .offset(offset)
    .all() as LogRow[];
}

export async function countLogs(): Promise<number> {
  if (isPg)
    return (
      (await sp.select({ c: sql<number>`count(*)` }).from(pg.logs))[0]?.c ?? 0
    );
  return (
    sq
      .select({ c: sql<number>`count(*)` })
      .from(s.logs)
      .get()?.c ?? 0
  );
}

export async function getSetting(key: string): Promise<string | null> {
  if (isPg) {
    const r = await sp
      .select({ value: pg.settings.value })
      .from(pg.settings)
      .where(eq(pg.settings.key, key));
    return r[0]?.value ?? null;
  }
  return (
    sq
      .select({ value: s.settings.value })
      .from(s.settings)
      .where(eq(s.settings.key, key))
      .get()?.value ?? null
  );
}

export async function setSetting(key: string, value: string) {
  if (isPg) {
    await sp
      .insert(pg.settings)
      .values({ key, value, updated_at: Date.now() } as never)
      .onConflictDoUpdate({
        target: pg.settings.key,
        set: { value, updated_at: Date.now() },
      });
  } else {
    sq.insert(s.settings)
      .values({ key, value, updated_at: Date.now() })
      .onConflictDoUpdate({
        target: s.settings.key,
        set: { value, updated_at: Date.now() },
      })
      .run();
  }
}

export async function createAdminSession(
  token: string,
  ttlMs: number,
): Promise<void> {
  const now = Date.now();
  if (isPg)
    await sp
      .insert(pg.adminSessions)
      .values({ token, created_at: now, expires_at: now + ttlMs } as never);
  else
    sq.insert(s.adminSessions)
      .values({ token, created_at: now, expires_at: now + ttlMs })
      .run();
}

export async function getAdminSession(
  token: string,
): Promise<{ token: string; created_at: number; expires_at: number } | null> {
  if (isPg) {
    const rows = await sp
      .select()
      .from(pg.adminSessions)
      .where(eq(pg.adminSessions.token, token));
    return (
      (rows[0] as
        | { token: string; created_at: number; expires_at: number }
        | undefined) ?? null
    );
  }
  return sq
    .select()
    .from(s.adminSessions)
    .where(eq(s.adminSessions.token, token))
    .get() as unknown as {
    token: string;
    created_at: number;
    expires_at: number;
  } | null;
}

export async function deleteAdminSession(token: string) {
  if (isPg)
    await sp.delete(pg.adminSessions).where(eq(pg.adminSessions.token, token));
  else sq.delete(s.adminSessions).where(eq(s.adminSessions.token, token)).run();
}

export async function cleanExpiredSessions(now = Date.now()) {
  if (isPg)
    await sp
      .delete(pg.adminSessions)
      .where(lt(pg.adminSessions.expires_at, now));
  else
    sq.delete(s.adminSessions).where(lt(s.adminSessions.expires_at, now)).run();
}

// ---- GoBiz session (single row, id=1) ----
export async function saveGoBizSession(
  data: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(data);
  const now = Date.now();
  if (isPg) {
    await sp
      .insert(pg.gobizSessions)
      .values({ id: 1, data: json, updated_at: now } as never)
      .onConflictDoUpdate({
        target: pg.gobizSessions.id,
        set: { data: json, updated_at: now },
      });
  } else {
    sq.insert(s.gobizSessions)
      .values({ id: 1, data: json, updated_at: now })
      .onConflictDoUpdate({
        target: s.gobizSessions.id,
        set: { data: json, updated_at: now },
      })
      .run();
  }
}

export async function loadGoBizSession(): Promise<Record<
  string,
  unknown
> | null> {
  let data: string | null = null;
  if (isPg) {
    const rows = await sp
      .select()
      .from(pg.gobizSessions)
      .where(eq(pg.gobizSessions.id, 1));
    data = rows[0]?.data ?? null;
  } else {
    data =
      sq.select().from(s.gobizSessions).where(eq(s.gobizSessions.id, 1)).get()
        ?.data ?? null;
  }
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function deleteGoBizSession(): Promise<void> {
  if (isPg) await sp.delete(pg.gobizSessions).where(eq(pg.gobizSessions.id, 1));
  else sq.delete(s.gobizSessions).where(eq(s.gobizSessions.id, 1)).run();
}

// ---- Users (akun admin berbasis DB) ----
export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  created_at: number;
  updated_at: number;
}

export async function getUserByUsername(
  username: string,
): Promise<UserRow | null> {
  if (isPg) {
    const rows = await sp
      .select()
      .from(pg.users)
      .where(eq(pg.users.username, username));
    return (rows[0] as UserRow | undefined) ?? null;
  }
  return sq
    .select()
    .from(s.users)
    .where(eq(s.users.username, username))
    .get() as UserRow | null;
}

export async function countUsers(): Promise<number> {
  if (!process.env.DB_DRIVER) {
    return 0;
  }
  if (isPg)
    return (
      (await sp.select({ c: sql<number>`count(*)` }).from(pg.users))[0]?.c ?? 0
    );
  return (
    sq
      .select({ c: sql<number>`count(*)` })
      .from(s.users)
      .get()?.c ?? 0
  );
}

export async function createUser(u: {
  id: string;
  username: string;
  passwordHash: string;
  role?: string;
}): Promise<void> {
  const now = Date.now();
  if (isPg) {
    await sp.insert(pg.users).values({
      id: u.id,
      username: u.username,
      password_hash: u.passwordHash,
      role: u.role ?? "admin",
      created_at: now,
      updated_at: now,
    } as never);
  } else {
    sq.insert(s.users)
      .values({
        id: u.id,
        username: u.username,
        password_hash: u.passwordHash,
        role: u.role ?? "admin",
        created_at: now,
        updated_at: now,
      })
      .run();
  }
}

export async function updateUserPassword(
  id: string,
  passwordHash: string,
): Promise<void> {
  const now = Date.now();
  if (isPg) {
    await sp
      .update(pg.users)
      .set({ password_hash: passwordHash, updated_at: now })
      .where(eq(pg.users.id, id));
  } else {
    sq.update(s.users)
      .set({ password_hash: passwordHash, updated_at: now })
      .where(eq(s.users.id, id))
      .run();
  }
}
