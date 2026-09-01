CREATE TABLE "webhook_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"payload" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_retry_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_queue" ADD CONSTRAINT "webhook_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;