CREATE TABLE "driver_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"driver_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"expected_sha256" text NOT NULL,
	"expected_bytes" integer NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"object_key" text,
	"object_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "driver_documents_kind" CHECK ("driver_documents"."kind" in ('driver_license','vehicle_registration','vehicle_insurance')),
	CONSTRAINT "driver_documents_type" CHECK ("driver_documents"."content_type" in ('image/jpeg','image/png','application/pdf')),
	CONSTRAINT "driver_documents_hash" CHECK ("driver_documents"."expected_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "driver_documents_bytes" CHECK ("driver_documents"."expected_bytes" between 1 and 10485760),
	CONSTRAINT "driver_documents_state" CHECK ("driver_documents"."state" in ('reserved','quarantined')),
	CONSTRAINT "driver_documents_object" CHECK (("driver_documents"."state"='reserved' AND "driver_documents"."object_key" IS NULL AND "driver_documents"."object_version" IS NULL) OR ("driver_documents"."state"='quarantined' AND "driver_documents"."object_key" IS NOT NULL AND "driver_documents"."object_version" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_documents_owner" ON "driver_documents" USING btree ("driver_id","created_at");