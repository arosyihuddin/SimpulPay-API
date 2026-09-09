ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_merchant_id_merchants_id_fk";
--> statement-breakpoint
ALTER TABLE "claims" DROP CONSTRAINT IF EXISTS "claims_merchant_id_merchants_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_merchant_id_merchants_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "qris_merchant_id_merchants_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_merchant_id_merchants_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;