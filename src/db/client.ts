// Drizzle client — multi-driver. DB_DRIVER: sqlite (default) | postgres.
import "dotenv/config";
import { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { type NodePgDatabase, drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import * as path from "node:path";
import * as fs from "node:fs";
import * as pg from "pg";
import * as schemaSqlite from "./schema";
import * as schemaPg from "./schema.pg";

export const DB_DRIVER: "sqlite" | "postgres" = process.env.DB_DRIVER === "postgres" ? "postgres" : "sqlite";

// DDL postgres idempoten — CREATE TABLE IF NOT EXISTS. Dijalankan di main.ts
// (awaited sebelum server listen) supaya setup-status & query lain lihat tabel
// yang pasti sudah ada, tak peduli ini run pertama atau ke-n.
export const PG_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS qris (
    id TEXT PRIMARY KEY, code TEXT NOT NULL, amount INTEGER NOT NULL,
    base_amount INTEGER NOT NULL DEFAULT 0, unique_code INTEGER NOT NULL DEFAULT 0,
    trx_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', transaction_json TEXT,
    created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_qris_trx ON qris(trx_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qris_exp ON qris(expires_at)`,
  `CREATE TABLE IF NOT EXISTS claims (
    tx_id TEXT PRIMARY KEY, qris_id TEXT, claimed_at BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_at ON claims(claimed_at)`,
  `CREATE TABLE IF NOT EXISTS logs (
    id BIGSERIAL PRIMARY KEY, timestamp TEXT NOT NULL,
    type TEXT NOT NULL, message TEXT NOT NULL, details_json TEXT)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gobiz_sessions (
    id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin',
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`,
];

export async function ensureSchema(): Promise<void> {
  if (DB_DRIVER !== "postgres" || !pool) return;
  for (const sql of PG_SCHEMA_SQL) {
    await pool.query(sql);
  }
}

export let rawDb: Database | null = null;      // bun:sqlite (untuk claimTx changes + bootstrap)
export let db: BunSQLiteDatabase<typeof schemaSqlite> | NodePgDatabase<typeof schemaPg>;
export let pool: pg.Pool | null = null;

if (DB_DRIVER === "postgres") {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  db = drizzlePg(pool, { schema: schemaPg });
} else {
  const DB_PATH = process.env.DATABASE_PATH || path.join(import.meta.dirname, "..", "..", "data", "gateway.db");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  rawDb = new Database(DB_PATH, { create: true });
  rawDb.run("PRAGMA journal_mode = WAL;");

  // Bootstrap schema idempoten (IF NOT EXISTS). Postgres pakai migrasi (drizzle-kit generate+push).
  rawDb.run(`
CREATE TABLE IF NOT EXISTS qris (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, amount INTEGER NOT NULL,
  base_amount INTEGER NOT NULL DEFAULT 0, unique_code INTEGER NOT NULL DEFAULT 0,
  trx_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', transaction_json TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qris_trx ON qris(trx_id);
CREATE INDEX IF NOT EXISTS idx_qris_exp ON qris(expires_at);
CREATE TABLE IF NOT EXISTS claims (
  tx_id TEXT PRIMARY KEY, qris_id TEXT, claimed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_at ON claims(claimed_at);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
  type TEXT NOT NULL, message TEXT NOT NULL, details_json TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gobiz_sessions (
  id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
`);
  db = drizzleSqlite(rawDb, { schema: schemaSqlite });
}