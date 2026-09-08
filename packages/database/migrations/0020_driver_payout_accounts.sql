CREATE TABLE "driver_payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"source" text NOT NULL,
	"account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_payout_accounts" ADD CONSTRAINT "driver_payout_accounts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_payout_driver_source" ON "driver_payout_accounts" USING btree ("driver_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_payout_account_source" ON "driver_payout_accounts" USING btree ("source","account_id");