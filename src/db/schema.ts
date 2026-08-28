// Drizzle schema — sqlite dialect. Kolom 1:1 dengan schema lama.
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const qris = sqliteTable(
  "qris",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    amount: integer("amount").notNull(),
    base_amount: integer("base_amount").notNull().default(0),
    unique_code: integer("unique_code").notNull().default(0),
    trx_id: text("trx_id").notNull(),
    status: text("status").notNull().default("PENDING"),
    transaction_json: text("transaction_json"),
    created_at: integer("created_at").notNull(),
    expires_at: integer("expires_at").notNull(),
  },
  (t) => [index("idx_qris_trx").on(t.trx_id), index("idx_qris_exp").on(t.expires_at)],
);

export const claims = sqliteTable(
  "claims",
  {
    tx_id: text("tx_id").primaryKey(),
    qris_id: text("qris_id"),
    claimed_at: integer("claimed_at").notNull(),
  },
  (t) => [index("idx_claims_at").on(t.claimed_at)],
);

export const logs = sqliteTable("logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  details_json: text("details_json"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const adminSessions = sqliteTable("admin_sessions", {
  token: text("token").primaryKey(),
  created_at: integer("created_at").notNull(),
  expires_at: integer("expires_at").notNull(),
});

export const gobizSessions = sqliteTable("gobiz_sessions", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});