ALTER TABLE "api_keys" ADD COLUMN "merchant_id" text;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE no action ON UPDATE no action;
