import { pgTable, text, integer, bigint, bigserial } from "drizzle-orm/pg-core";

export const qris = pgTable("qris", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  amount: integer("amount").notNull(),
  base_amount: integer("base_amount").notNull().default(0),
  unique_code: integer("unique_code").notNull().default(0),
  trx_id: text("trx_id").notNull(),
  status: text("status").notNull().default("PENDING"),
  transaction_json: text("transaction_json"),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  expires_at: bigint("expires_at", { mode: "number" }).notNull(),
});

export const claims = pgTable("claims", {
  tx_id: text("tx_id").primaryKey(),
  qris_id: text("qris_id"),
  claimed_at: bigint("claimed_at", { mode: "number" }).notNull(),
});

export const logs = pgTable("logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  timestamp: text("timestamp").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  details_json: text("details_json"),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});

export const adminSessions = pgTable("admin_sessions", {
  token: text("token").primaryKey(),
  user_id: text("user_id"),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  expires_at: bigint("expires_at", { mode: "number" }).notNull(),
});

export const gobizSessions = pgTable("gobiz_sessions", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});
