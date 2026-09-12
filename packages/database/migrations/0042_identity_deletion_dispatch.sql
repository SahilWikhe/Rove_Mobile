ALTER TABLE "account_closures" ADD COLUMN "identity_attempted_at" timestamp with time zone;--> statement-breakpoint
DROP TRIGGER closure_retention_hold ON account_closures;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_closure_retention_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.identity_attempted_at IS NOT NULL OR NEW.identity_removed_at IS NOT NULL
    THEN RAISE EXCEPTION 'New closure must precede identity dispatch'; END IF;
  ELSE
    IF OLD.identity_attempted_at IS NOT NULL AND NEW.identity_attempted_at IS DISTINCT FROM OLD.identity_attempted_at
    THEN RAISE EXCEPTION 'Identity dispatch evidence is immutable'; END IF;
    IF OLD.identity_removed_at IS NULL AND NEW.identity_removed_at IS NOT NULL AND NEW.identity_attempted_at IS NULL
    THEN RAISE EXCEPTION 'Identity removal requires dispatch evidence'; END IF;
  END IF;
  IF NEW.identity_attempted_at < NEW.closed_at
  THEN RAISE EXCEPTION 'Identity dispatch must follow closure'; END IF;
  IF TG_OP='INSERT' OR NEW.identity_attempted_at IS DISTINCT FROM OLD.identity_attempted_at THEN
    PERFORM id FROM users WHERE id=NEW.owner_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM retention_holds WHERE owner_id=NEW.owner_id AND released_at IS NULL)
    THEN RAISE EXCEPTION 'Active retention hold blocks account closure or identity dispatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closure_retention_hold BEFORE INSERT OR UPDATE OF identity_attempted_at,identity_removed_at ON account_closures
FOR EACH ROW EXECUTE FUNCTION enforce_closure_retention_hold();
