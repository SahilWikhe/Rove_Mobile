CREATE TABLE "push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"receipt_id" uuid,
	"accepted_at" timestamp with time zone,
	"lease_token" uuid,
	"locked_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"receipt_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_delivery_revision" CHECK ("push_deliveries"."revision">0),
	CONSTRAINT "push_delivery_state" CHECK ("push_deliveries"."state" in ('pending','sending','receipt','accepted_by_gateway','suppressed','invalid_token','configuration','rejected','receipt_expired'))
);
--> statement-breakpoint
CREATE TABLE "push_rate_windows" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"window_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_event_id_outbox_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_installation_id_push_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."push_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_delivery_recipient" ON "push_deliveries" USING btree ("event_id","installation_id","revision");