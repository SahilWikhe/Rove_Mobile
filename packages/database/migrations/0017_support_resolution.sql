ALTER TABLE "support_requests" ADD COLUMN "response" text;--> statement-breakpoint
ALTER TABLE "support_requests" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_requests" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;