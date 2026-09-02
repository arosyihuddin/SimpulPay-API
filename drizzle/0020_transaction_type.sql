CREATE TYPE "public"."transaction_type" AS ENUM('merchant', 'subscription');--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "type" "transaction_type" DEFAULT 'merchant' NOT NULL;