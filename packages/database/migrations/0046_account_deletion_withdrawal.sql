DROP INDEX "account_deletion_owner";--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_owner" ON "account_deletion_requests" USING btree ("owner_id") WHERE "account_deletion_requests"."withdrawn_at" is null;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_withdrawal_time" CHECK ("account_deletion_requests"."withdrawn_at" is null or "account_deletion_requests"."withdrawn_at" >= "account_deletion_requests"."created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_account_deletion_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Account deletion consent is immutable'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.owner_id,NEW.support_request_id,NEW.consent_version,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.owner_id,OLD.support_request_id,OLD.consent_version,OLD.created_at)
      OR OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL
    THEN RAISE EXCEPTION 'Account deletion consent is immutable'; END IF;
    PERFORM id FROM users WHERE id=NEW.owner_id AND disabled=false FOR UPDATE;
    IF NOT FOUND OR EXISTS(SELECT 1 FROM account_closures WHERE owner_id=NEW.owner_id)
    THEN RAISE EXCEPTION 'Closed account consent cannot be withdrawn'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.withdrawn_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM support_requests s JOIN users u ON u.id=s.owner_id
    WHERE s.id=NEW.support_request_id AND s.owner_id=NEW.owner_id
      AND s.category='account' AND u.role IN ('rider','driver') AND u.disabled=false
  ) THEN RAISE EXCEPTION 'Account deletion consent must reference its consumer account ticket'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_account_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Account closure is immutable'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.request_id,NEW.owner_id,NEW.authorized_by,NEW.policy_reference,NEW.review_reference,NEW.closed_at)
      IS DISTINCT FROM (OLD.request_id,OLD.owner_id,OLD.authorized_by,OLD.policy_reference,OLD.review_reference,OLD.closed_at)
      OR (OLD.identity_removed_at IS NOT NULL AND NEW.identity_removed_at IS DISTINCT FROM OLD.identity_removed_at)
    THEN RAISE EXCEPTION 'Account closure is immutable'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM account_deletion_requests r JOIN users u ON u.id=r.owner_id
    WHERE r.id=NEW.request_id AND r.owner_id=NEW.owner_id AND u.disabled=true AND r.withdrawn_at IS NULL)
  THEN RAISE EXCEPTION 'Closure requires consent and disabled local account'; END IF;
  RETURN NEW;
END $$;
