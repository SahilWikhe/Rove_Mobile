CREATE TABLE "trip_message_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"through" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_message_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"support_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" integer GENERATED ALWAYS AS IDENTITY (sequence name "trip_messages_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"offer_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_messages_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "trip_message_text_length" CHECK (length(trim("trip_messages"."text")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "trip_message_reads" ADD CONSTRAINT "trip_message_reads_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_message_reads" ADD CONSTRAINT "trip_message_reads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_message_reports" ADD CONSTRAINT "trip_message_reports_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_message_reports" ADD CONSTRAINT "trip_message_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_message_reports" ADD CONSTRAINT "trip_message_reports_support_id_support_requests_id_fk" FOREIGN KEY ("support_id") REFERENCES "public"."support_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD CONSTRAINT "trip_messages_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD CONSTRAINT "trip_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_message_reader" ON "trip_message_reads" USING btree ("offer_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_message_reporter" ON "trip_message_reports" USING btree ("offer_id","reporter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_message_retry" ON "trip_messages" USING btree ("sender_id","request_id");--> statement-breakpoint
CREATE INDEX "trip_message_thread" ON "trip_messages" USING btree ("offer_id","sequence");--> statement-breakpoint
CREATE INDEX "trip_message_expiry" ON "trip_messages" USING btree ("created_at");