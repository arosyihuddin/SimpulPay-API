import {
  pgTable,
  text,
  integer,
  bigint,
  bigserial,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "customer"]);
export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "banned",
]);
export const merchantTypeEnum = pgEnum("merchant_type", ["gopay", "shopeepay"]);
export const merchantStatusEnum = pgEnum("merchant_status", [
  "active",
  "inactive",
]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "revoked"]);
export const planTypeEnum = pgEnum("plan_type", ["free", "paid"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "cancelled",
  "expired",
]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "pending",
  "paid",
  "overdue",
  "failed",
]);

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  amount: integer("amount").notNull(),
  base_amount: integer("base_amount").notNull().default(0),
  unique_code: integer("unique_code").notNull().default(0),
  trx_id: text("trx_id").notNull(),
  status: text("status").notNull().default("PENDING"),
  transaction_json: text("transaction_json"),
  merchant_id: text("merchant_id").references(() => merchants.id),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  expires_at: bigint("expires_at", { mode: "number" }).notNull(),
});

export const claims = pgTable("claims", {
  tx_id: text("tx_id").primaryKey(),
  transaction_id: text("transaction_id"),
  merchant_id: text("merchant_id").references(() => merchants.id),
  claimed_at: bigint("claimed_at", { mode: "number" }).notNull(),
});

export const logs = pgTable("logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  timestamp: text("timestamp").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  details_json: text("details_json"),
  user_id: text("user_id"),
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
  merchant_id: text("merchant_id")
    .primaryKey()
    .references(() => merchants.id),
  data: text("data").notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("admin"),
  status: userStatusEnum("status").notNull().default("active"),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});

export const merchants = pgTable("merchants", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  type: merchantTypeEnum("type").notNull().default("gopay"),
  name: text("name").notNull(),
  gopay_merchant_id: text("gopay_merchant_id"),
  qris_static: text("qris_static"),
  config_json: text("config_json"),
  status: merchantStatusEnum("status").notNull().default("active"),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  merchant_id: text("merchant_id").references(() => merchants.id),
  key: text("key").notNull().unique(),
  label: text("label"),
  status: apiKeyStatusEnum("status").notNull().default("active"),
  last_used_at: bigint("last_used_at", { mode: "number" }),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
});

export const notifications = pgTable("notifications", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  merchant_id: text("merchant_id").references(() => merchants.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  data_json: text("data_json"),
  read: boolean("read").notNull().default(false),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
});

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: planTypeEnum("type").notNull().default("paid"),
  price: integer("price").notNull().default(0),
  max_merchants: integer("max_merchants").notNull().default(1),
  daily_paid_limit: integer("daily_paid_limit"),
  features_json: text("features_json"),
  active: boolean("active").notNull().default(true),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  plan_id: text("plan_id")
    .notNull()
    .references(() => plans.id),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  starts_at: bigint("starts_at", { mode: "number" }).notNull(),
  ends_at: bigint("ends_at", { mode: "number" }),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});

export const announcements = pgTable("announcements", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"),
  active: boolean("active").notNull().default(true),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  subscription_id: text("subscription_id")
    .notNull()
    .references(() => subscriptions.id),
  amount: integer("amount").notNull(),
  status: invoiceStatusEnum("status").notNull().default("pending"),
  period_start: bigint("period_start", { mode: "number" }).notNull(),
  period_end: bigint("period_end", { mode: "number" }).notNull(),
  paid_at: bigint("paid_at", { mode: "number" }),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
});
