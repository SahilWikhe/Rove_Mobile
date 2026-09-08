CREATE TYPE "public"."ride_status" AS ENUM('searching', 'matched', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_driver_found', 'no_show', 'interrupted', 'terminated');--> statement-breakpoint
CREATE TABLE "audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"service" text DEFAULT 'standard' NOT NULL,
	"location" jsonb,
	"location_at" timestamp with time zone,
	"vehicle" jsonb
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "valid_offer_status" CHECK ("offers"."status" in ('pending','accepted','declined','expired','revoked'))
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_dedupeKey_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rider_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"driver_id" uuid,
	"state" "ride_status" DEFAULT 'searching' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"fare_cents" integer NOT NULL,
	"earnings_cents" integer NOT NULL,
	"payment_state" text DEFAULT 'pending' NOT NULL,
	"search_deadline" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rides_quoteId_unique" UNIQUE("quote_id"),
	CONSTRAINT "positive_ride_money" CHECK ("rides"."fare_cents" >= 0 and "rides"."earnings_cents" >= 0),
	CONSTRAINT "positive_ride_version" CHECK ("rides"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_subject_unique" UNIQUE("subject"),
	CONSTRAINT "valid_user_role" CHECK ("users"."role" in ('rider', 'driver', 'staff'))
);
--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "actor_command_key" ON "commands" USING btree ("actor_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_offer_per_ride" ON "offers" USING btree ("ride_id") WHERE "offers"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_offer_per_driver" ON "offers" USING btree ("driver_id") WHERE "offers"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "driver_offered_once_per_ride" ON "offers" USING btree ("ride_id","driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_ride_per_rider" ON "rides" USING btree ("rider_id") WHERE "rides"."state" in ('searching','matched','en_route','arrived','in_progress','interrupted');--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_ride_per_driver" ON "rides" USING btree ("driver_id") WHERE "rides"."state" in ('matched','en_route','arrived','in_progress','interrupted');