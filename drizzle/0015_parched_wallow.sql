DROP TABLE "user_settings" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "settings_json" text;