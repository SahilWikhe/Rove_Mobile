CREATE TABLE "driver_vehicle_submissions" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"revision" uuid NOT NULL,
	"vehicle" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_vehicle_submission_status" CHECK ("driver_vehicle_submissions"."status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "driver_vehicle_submissions" ADD CONSTRAINT "driver_vehicle_submissions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;