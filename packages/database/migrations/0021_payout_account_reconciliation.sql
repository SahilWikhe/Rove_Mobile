CREATE TABLE "payout_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_created" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_payout_accounts" ADD COLUMN "sync_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_payout_accounts" ADD COLUMN "status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_payout_accounts" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "driver_payout_accounts" ADD COLUMN "last_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "payout_valid_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_webhook_source_event" ON "payout_webhook_events" USING btree ("source","event_id");