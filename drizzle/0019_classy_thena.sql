CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'paid', 'expired');--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."transaction_status";--> statement-breakpoint
UPDATE "transactions" SET "status" = lower("status");--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "status" SET DATA TYPE "public"."transaction_status" USING "status"::"public"."transaction_status";