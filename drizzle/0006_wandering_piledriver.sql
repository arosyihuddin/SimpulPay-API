ALTER TABLE "gobiz_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "gobiz_sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "merchants" ALTER COLUMN "config_json" SET DATA TYPE jsonb USING "config_json"::jsonb;
