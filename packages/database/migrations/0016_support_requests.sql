CREATE TABLE "support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_request_status" CHECK ("support_requests"."status" IN ('open','resolved')),
	CONSTRAINT "support_request_category" CHECK ("support_requests"."category" IN ('account','vehicle','trip','payment','other')),
	CONSTRAINT "support_request_message_length" CHECK (length("support_requests"."message") BETWEEN 10 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_requests_owner" ON "support_requests" USING btree ("owner_id","created_at");