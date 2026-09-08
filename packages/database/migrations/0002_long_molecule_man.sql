ALTER TABLE "outbox" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "dead_letter_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "last_error_code" text;