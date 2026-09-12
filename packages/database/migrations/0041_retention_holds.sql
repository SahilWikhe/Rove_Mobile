CREATE TABLE "retention_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason_reference" text NOT NULL,
	"review_at" timestamp with time zone NOT NULL,
	"placed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_reference" text,
	CONSTRAINT "retention_hold_kind" CHECK ("retention_holds"."kind" in ('legal','safety','privacy')),
	CONSTRAINT "retention_hold_reference" CHECK (length("retention_holds"."reason_reference") between 1 and 128),
	CONSTRAINT "retention_hold_release" CHECK (("retention_holds"."released_at" is null and "retention_holds"."released_by" is null and "retention_holds"."release_reference" is null) or ("retention_holds"."released_at" is not null and "retention_holds"."released_by" is not null and "retention_holds"."release_reference" is not null and length("retention_holds"."release_reference") between 1 and 128 and "retention_holds"."released_at">="retention_holds"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retention_active_case" ON "retention_holds" USING btree ("owner_id","kind","reason_reference") WHERE "retention_holds"."released_at" is null;--> statement-breakpoint
CREATE INDEX "retention_review_queue" ON "retention_holds" USING btree ("review_at","id");--> statement-breakpoint
CREATE FUNCTION protect_retention_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retention hold evidence is immutable'; END IF;
  PERFORM id FROM users WHERE id=NEW.owner_id AND role IN ('rider','driver') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retention holds require a consumer account'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.owner_id,NEW.kind,NEW.reason_reference,NEW.review_at,NEW.placed_by,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.owner_id,OLD.kind,OLD.reason_reference,OLD.review_at,OLD.placed_by,OLD.created_at)
      OR (OLD.released_at IS NOT NULL AND (NEW.released_at,NEW.released_by,NEW.release_reference)
        IS DISTINCT FROM (OLD.released_at,OLD.released_by,OLD.release_reference))
    THEN RAISE EXCEPTION 'Retention hold evidence is immutable'; END IF;
  ELSIF NEW.released_at IS NOT NULL OR NEW.released_by IS NOT NULL OR NEW.release_reference IS NOT NULL THEN
    RAISE EXCEPTION 'New retention holds must be active';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER retention_hold_evidence BEFORE INSERT OR UPDATE OR DELETE ON retention_holds
FOR EACH ROW EXECUTE FUNCTION protect_retention_hold();
--> statement-breakpoint
CREATE FUNCTION enforce_closure_retention_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.identity_removed_at IS DISTINCT FROM OLD.identity_removed_at THEN
    PERFORM id FROM users WHERE id=NEW.owner_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM retention_holds WHERE owner_id=NEW.owner_id AND released_at IS NULL)
    THEN RAISE EXCEPTION 'Active retention hold blocks account closure or identity removal'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closure_retention_hold BEFORE INSERT OR UPDATE OF identity_removed_at ON account_closures
FOR EACH ROW EXECUTE FUNCTION enforce_closure_retention_hold();
