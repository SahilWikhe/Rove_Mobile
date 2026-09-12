CREATE TABLE payment_dispute_checks (
  attempt_id uuid PRIMARY KEY REFERENCES payment_attempts(id),
  revision integer NOT NULL DEFAULT 0 CONSTRAINT dispute_check_revision CHECK (revision >= 0),
  disputes jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT dispute_check_array CHECK (jsonb_typeof(disputes) = 'array'),
  verified_at timestamptz,
  requested_at timestamptz
);
--> statement-breakpoint
CREATE TABLE payment_dispute_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES payment_attempts(id),
  revision integer NOT NULL CONSTRAINT dispute_observation_positive_revision CHECK (revision > 0),
  disputes jsonb NOT NULL CONSTRAINT dispute_observation_array CHECK (jsonb_typeof(disputes) = 'array'),
  verified_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX dispute_observation_revision ON payment_dispute_observations(attempt_id,revision);
--> statement-breakpoint
CREATE FUNCTION rove_preserve_dispute_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Dispute observations are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispute_observation_immutable BEFORE UPDATE OR DELETE ON payment_dispute_observations
FOR EACH ROW EXECUTE FUNCTION rove_preserve_dispute_observation();

--> statement-breakpoint
ALTER TABLE ledger_postings DROP CONSTRAINT ledger_valid_account;
--> statement-breakpoint
ALTER TABLE ledger_postings ADD CONSTRAINT ledger_valid_account CHECK (account IN ('stripe_clearing','rider_funds','driver_payable','platform_revenue','refund_suspense','processor_fees','dispute_suspense'));
