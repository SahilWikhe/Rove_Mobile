CREATE TABLE "account_closures" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"authorized_by" uuid NOT NULL,
	"policy_reference" text NOT NULL,
	"review_reference" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"identity_removed_at" timestamp with time zone,
	CONSTRAINT "account_closures_ownerId_unique" UNIQUE("owner_id"),
	CONSTRAINT "account_closure_policy" CHECK (length("account_closures"."policy_reference") between 1 and 128),
	CONSTRAINT "account_closure_review" CHECK (length("account_closures"."review_reference") between 1 and 128),
	CONSTRAINT "account_closure_identity_time" CHECK ("account_closures"."identity_removed_at" is null or "account_closures"."identity_removed_at" >= "account_closures"."closed_at")
);
--> statement-breakpoint
ALTER TABLE "account_closures" ADD CONSTRAINT "account_closures_request_id_account_deletion_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."account_deletion_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_closures" ADD CONSTRAINT "account_closures_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_closures" ADD CONSTRAINT "account_closures_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION protect_account_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Account closure is immutable'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.request_id,NEW.owner_id,NEW.authorized_by,NEW.policy_reference,NEW.review_reference,NEW.closed_at)
      IS DISTINCT FROM (OLD.request_id,OLD.owner_id,OLD.authorized_by,OLD.policy_reference,OLD.review_reference,OLD.closed_at)
      OR (OLD.identity_removed_at IS NOT NULL AND NEW.identity_removed_at IS DISTINCT FROM OLD.identity_removed_at)
    THEN RAISE EXCEPTION 'Account closure is immutable'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM account_deletion_requests r JOIN users u ON u.id=r.owner_id
    WHERE r.id=NEW.request_id AND r.owner_id=NEW.owner_id AND u.disabled=true)
  THEN RAISE EXCEPTION 'Closure requires consent and disabled local account'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER account_closure_immutable BEFORE INSERT OR UPDATE OR DELETE ON account_closures
FOR EACH ROW EXECUTE FUNCTION protect_account_closure();
--> statement-breakpoint
CREATE FUNCTION protect_closed_account_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM account_closures WHERE owner_id=OLD.id)
    AND (NEW.disabled=false OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.role IS DISTINCT FROM OLD.role)
  THEN RAISE EXCEPTION 'Closed account access cannot be restored'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_account_access BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION protect_closed_account_access();
--> statement-breakpoint
CREATE FUNCTION protect_active_ride_accounts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('searching','matched','en_route','arrived','in_progress','interrupted') THEN
    PERFORM id FROM users WHERE id=NEW.rider_id AND role='rider' AND disabled=false FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active ride requires active rider'; END IF;
    IF NEW.driver_id IS NOT NULL THEN
      PERFORM id FROM users WHERE id=NEW.driver_id AND role='driver' AND disabled=false FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Active ride requires active driver'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER active_ride_accounts BEFORE INSERT OR UPDATE OF rider_id,driver_id,state ON rides
FOR EACH ROW EXECUTE FUNCTION protect_active_ride_accounts();
--> statement-breakpoint
CREATE FUNCTION protect_online_driver_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.online THEN
    PERFORM id FROM users WHERE id=NEW.id AND role='driver' AND disabled=false FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Online driver requires active account'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER online_driver_account BEFORE INSERT OR UPDATE OF online ON drivers
FOR EACH ROW EXECUTE FUNCTION protect_online_driver_account();
