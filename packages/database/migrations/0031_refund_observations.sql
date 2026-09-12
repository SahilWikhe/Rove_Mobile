CREATE TABLE payment_refund_checks (
  attempt_id uuid PRIMARY KEY REFERENCES payment_attempts(id),
  revision integer NOT NULL DEFAULT 0 CONSTRAINT refund_check_revision CHECK (revision >= 0),
  refunds jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT refund_check_array CHECK (jsonb_typeof(refunds) = 'array'),
  received_cents integer NOT NULL DEFAULT 0 CONSTRAINT refund_check_amount CHECK (received_cents >= 0 AND received_cents <= 99999999),
  verified_at timestamptz,
  requested_at timestamptz
);
--> statement-breakpoint
CREATE TABLE payment_refund_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES payment_attempts(id),
  revision integer NOT NULL CONSTRAINT refund_observation_positive_revision CHECK (revision > 0),
  refunds jsonb NOT NULL CONSTRAINT refund_observation_array CHECK (jsonb_typeof(refunds) = 'array'),
  received_cents integer NOT NULL CONSTRAINT refund_observation_amount CHECK (received_cents >= 0 AND received_cents <= 99999999),
  verified_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX refund_observation_revision ON payment_refund_observations(attempt_id,revision);
--> statement-breakpoint
CREATE FUNCTION rove_preserve_refund_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Refund observations are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_observation_immutable BEFORE UPDATE OR DELETE ON payment_refund_observations
FOR EACH ROW EXECUTE FUNCTION rove_preserve_refund_observation();
