CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"customer_binding_id" uuid NOT NULL,
	"intent_id" text NOT NULL,
	"source" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"provider_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciled_at" timestamp with time zone,
	CONSTRAINT "payment_attempts_rideId_unique" UNIQUE("ride_id"),
	CONSTRAINT "valid_payment_attempt_amount" CHECK ("payment_attempts"."amount_cents" >= 50 and "payment_attempts"."amount_cents" <= 99999999),
	CONSTRAINT "valid_payment_attempt_revision" CHECK ("payment_attempts"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"source" text NOT NULL,
	"customer_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_customer_binding_id_payment_customers_id_fk" FOREIGN KEY ("customer_binding_id") REFERENCES "public"."payment_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_provider_source" ON "payment_attempts" USING btree ("source","intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_customer_rider_source" ON "payment_customers" USING btree ("rider_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_customer_provider_source" ON "payment_customers" USING btree ("source","customer_id");