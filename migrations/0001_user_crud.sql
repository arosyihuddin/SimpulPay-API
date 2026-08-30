-- GoMerch API — migration lanjutan: admin_sessions.user_id (role lookup per sesi).
-- CREATE TABLE IF NOT EXISTS tidak mengubah tabel existing, jadi perlu ALTER manual.
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);
