CREATE TABLE refund_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL REFERENCES payment_attempts(id),
 authorized_by uuid NOT NULL REFERENCES users(id),
 amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999),
 reason text NOT NULL CHECK (reason IN ('customer_request','service_issue','duplicate_payment')),
 policy_reference text NOT NULL CHECK (length(policy_reference) BETWEEN 1 AND 128),
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','submitted','review_required')),
 provider_refund_id text UNIQUE CHECK (provider_refund_id ~ '^re_[a-zA-Z0-9]{1,96}$'),
 first_attempt_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((state='submitted') = (provider_refund_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX refund_operations_attempt ON refund_operations(attempt_id);
--> statement-breakpoint
CREATE FUNCTION rove_preserve_refund_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Refund authorizations are immutable'; END IF;
 IF (NEW.id,NEW.attempt_id,NEW.authorized_by,NEW.amount_cents,NEW.reason,NEW.policy_reference,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.attempt_id,OLD.authorized_by,OLD.amount_cents,OLD.reason,OLD.policy_reference,OLD.created_at)
 OR (OLD.first_attempt_at IS NOT NULL AND NEW.first_attempt_at IS DISTINCT FROM OLD.first_attempt_at)
 OR (OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id)
 THEN RAISE EXCEPTION 'Refund authorizations are immutable'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_authorization_immutable BEFORE UPDATE OR DELETE ON refund_operations
FOR EACH ROW EXECUTE FUNCTION rove_preserve_refund_authorization();
