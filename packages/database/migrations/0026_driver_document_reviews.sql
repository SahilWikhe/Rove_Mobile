CREATE TABLE "driver_document_reviews" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"object_key" text NOT NULL,
	"object_version" text NOT NULL,
	"sha256" text NOT NULL,
	CONSTRAINT "driver_document_reviews_hash" CHECK ("driver_document_reviews"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "driver_document_reviews_decision" CHECK (
      ("driver_document_reviews"."decision"='approved' AND "driver_document_reviews"."reason" IS NULL AND "driver_document_reviews"."expires_at" IS NOT NULL AND "driver_document_reviews"."expires_at">"driver_document_reviews"."reviewed_at")
      OR ("driver_document_reviews"."decision"='rejected' AND "driver_document_reviews"."reason" IS NOT NULL AND "driver_document_reviews"."reason" IN ('unreadable','wrong_document','expired','details_mismatch') AND "driver_document_reviews"."expires_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "driver_document_reviews" ADD CONSTRAINT "driver_document_reviews_document_id_driver_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."driver_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_document_reviews" ADD CONSTRAINT "driver_document_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;