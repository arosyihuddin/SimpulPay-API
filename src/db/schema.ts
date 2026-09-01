import {
  pgTable,
  text,
  integer,
  bigint,
  bigserial,
  boolean,
  pgEnum,
  jsonb,
  primaryKey,
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
  "pending",
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
  merchant_id: text("merchant_id").references(() => merchants.id, {
    onDelete: "set null",
  }),
  user_id: text("user_id").references(() => users.id),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  expires_at: bigint("expires_at", { mode: "number" }).notNull(),
});

export const claims = pgTable("claims", {
  tx_id: text("tx_id").primaryKey(),
  transaction_id: text("transaction_id"),
  merchant_id: text("merchant_id").references(() => merchants.id, {
    onDelete: "cascade",
  }),
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

export const systemSettings = pgTable("system_settings", {
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

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  name: text("name"),
  phone: text("phone"),
  settings_json: text("settings_json"),
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
  merchant_id: text("merchant_id"),
  qris_static: text("qris_static"),
  config_json: jsonb("config_json"),
  status: merchantStatusEnum("status").notNull().default("active"),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  merchant_id: text("merchant_id").references(() => merchants.id, {
    onDelete: "cascade",
  }),
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
  merchant_id: text("merchant_id").references(() => merchants.id, {
    onDelete: "cascade",
  }),
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

// Baca/dismiss announcement per user (banner hide). Broadcast tetap 1 row,
// read state user disimpen di sini, bukan di announcements.
export const announcementReads = pgTable(
  "announcement_reads",
  {
    announcement_id: bigint("announcement_id", { mode: "number" })
      .notNull()
      .references(() => announcements.id),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    read_at: bigint("read_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.announcement_id, t.user_id] })],
);

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  subscription_id: text("subscription_id")
    .notNull()
    .references(() => subscriptions.id),
  transaction_id: text("transaction_id").references(() => transactions.id),
  amount: integer("amount").notNull(),
  status: invoiceStatusEnum("status").notNull().default("pending"),
  period_start: bigint("period_start", { mode: "number" }).notNull(),
  period_end: bigint("period_end", { mode: "number" }).notNull(),
  paid_at: bigint("paid_at", { mode: "number" }),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
});

export const webhookQueue = pgTable("webhook_queue", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  payload: text("payload").notNull(),
  attempt: integer("attempt").notNull().default(0),
  next_retry_at: bigint("next_retry_at", { mode: "number" }).notNull(),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
});
