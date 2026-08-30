-- GoMerch API — Postgres schema (Supabase). Jalankan di Supabase SQL editor / psql.
CREATE TABLE IF NOT EXISTS qris (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, amount INTEGER NOT NULL,
  base_amount INTEGER NOT NULL DEFAULT 0, unique_code INTEGER NOT NULL DEFAULT 0,
  trx_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', transaction_json TEXT,
  created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qris_trx ON qris(trx_id);
CREATE INDEX IF NOT EXISTS idx_qris_exp ON qris(expires_at);

CREATE TABLE IF NOT EXISTS claims (
  tx_id TEXT PRIMARY KEY, qris_id TEXT, claimed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_at ON claims(claimed_at);

CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY, timestamp TEXT NOT NULL,
  type TEXT NOT NULL, message TEXT NOT NULL, details_json TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY, user_id TEXT, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);

CREATE TABLE IF NOT EXISTS gobiz_sessions (
  id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
