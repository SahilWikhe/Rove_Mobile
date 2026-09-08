CREATE TABLE "staff_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"permission" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"verified_service" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_review_decisions_revision_unique" UNIQUE("revision"),
	CONSTRAINT "vehicle_review_decision_value" CHECK ("vehicle_review_decisions"."decision" IN ('approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "staff_permissions" ADD CONSTRAINT "staff_permissions_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_review_decisions" ADD CONSTRAINT "vehicle_review_decisions_revision_driver_vehicle_history_revision_fk" FOREIGN KEY ("revision") REFERENCES "public"."driver_vehicle_history"("revision") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_review_decisions" ADD CONSTRAINT "vehicle_review_decisions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_permission_unique" ON "staff_permissions" USING btree ("staff_id","permission");--> statement-breakpoint
CREATE FUNCTION prevent_vehicle_review_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Vehicle review decisions cannot be edited';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_vehicle_review BEFORE UPDATE ON vehicle_review_decisions
FOR EACH ROW EXECUTE FUNCTION prevent_vehicle_review_update();
