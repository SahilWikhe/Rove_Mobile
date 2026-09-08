CREATE TABLE "driver_vehicle_history" (
	"revision" uuid PRIMARY KEY NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle" jsonb NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_vehicle_history" ADD CONSTRAINT "driver_vehicle_history_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_vehicle_history_owner" ON "driver_vehicle_history" USING btree ("driver_id","submitted_at");--> statement-breakpoint
INSERT INTO driver_vehicle_history(revision,driver_id,vehicle,submitted_at)
SELECT revision,driver_id,vehicle,submitted_at FROM driver_vehicle_submissions
ON CONFLICT(revision) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION prevent_vehicle_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Submitted vehicle revisions cannot be edited';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_vehicle_history BEFORE UPDATE ON driver_vehicle_history
FOR EACH ROW EXECUTE FUNCTION prevent_vehicle_history_update();
