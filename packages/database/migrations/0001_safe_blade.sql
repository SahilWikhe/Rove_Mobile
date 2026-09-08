ALTER TABLE "drivers" ADD COLUMN "payout_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "eligibility_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "location_sequence" integer DEFAULT 0 NOT NULL;