CREATE TYPE "public"."api_key_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'paid', 'overdue', 'failed');--> statement-breakpoint
CREATE TYPE "public"."merchant_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."merchant_type" AS ENUM('gopay', 'shopeepay');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('free', 'paid');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'customer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text,
	"status" "api_key_status" DEFAULT 'active' NOT NULL,
	"last_used_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"tx_id" text PRIMARY KEY NOT NULL,
	"qris_id" text,
	"merchant_id" text,
	"claimed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gobiz_sessions" (
	"merchant_id" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"period_start" bigint NOT NULL,
	"period_end" bigint NOT NULL,
	"paid_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"timestamp" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"details_json" text
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "merchant_type" DEFAULT 'gopay' NOT NULL,
	"name" text NOT NULL,
	"gopay_merchant_id" text,
	"qris_static" text,
	"config_json" text,
	"status" "merchant_status" DEFAULT 'active' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"merchant_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"data_json" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "plan_type" DEFAULT 'paid' NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"max_merchants" integer DEFAULT 1 NOT NULL,
	"features_json" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qris" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"amount" integer NOT NULL,
	"base_amount" integer DEFAULT 0 NOT NULL,
	"unique_code" integer DEFAULT 0 NOT NULL,
	"trx_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"transaction_json" text,
	"merchant_id" text,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"starts_at" bigint NOT NULL,
	"ends_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'admin' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gobiz_sessions" ADD CONSTRAINT "gobiz_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qris" ADD CONSTRAINT "qris_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_qris_trx ON qris(trx_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_qris_exp ON qris(expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_qris_merchant ON qris(merchant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_claims_at ON claims(claimed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_claims_merchant ON claims(merchant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_merchants_user ON merchants(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notifications_merchant ON notifications(merchant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices(subscription_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
--> statement-breakpoint
INSERT INTO plans (id, name, type, price, max_merchants, features_json, active, created_at, updated_at)
VALUES
('p_free', 'Free', 'free', 0, 1, NULL, true, 0, 0),
('p_starter', 'Starter', 'paid', 50000, 3, '{"priority_support": true}', true, 0, 0);
