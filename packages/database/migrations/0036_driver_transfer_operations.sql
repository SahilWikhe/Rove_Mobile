CREATE TABLE "driver_transfer_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"payout_binding_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"authorized_by" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"policy_reference" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"charge_id" text,
	"provider_transfer_id" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"reversed_cents" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone,
	"requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_transfer_operations_providerTransferId_unique" UNIQUE("provider_transfer_id"),
	CONSTRAINT "driver_transfer_amount" CHECK ("driver_transfer_operations"."amount_cents" between 1 and 99999999),
	CONSTRAINT "driver_transfer_policy" CHECK (length("driver_transfer_operations"."policy_reference") between 1 and 128),
	CONSTRAINT "driver_transfer_state" CHECK ("driver_transfer_operations"."state" in ('queued','confirmed','review_required','canceled')),
	CONSTRAINT "driver_transfer_revision" CHECK ("driver_transfer_operations"."revision" >= 0),
	CONSTRAINT "driver_transfer_reversed" CHECK ("driver_transfer_operations"."reversed_cents" between 0 and "driver_transfer_operations"."amount_cents"),
	CONSTRAINT "driver_transfer_account" CHECK ("driver_transfer_operations"."account_id" ~ '^acct_[a-zA-Z0-9]{1,96}$'),
	CONSTRAINT "driver_transfer_charge" CHECK ("driver_transfer_operations"."charge_id" is null or "driver_transfer_operations"."charge_id" ~ '^ch_[a-zA-Z0-9]{1,96}$'),
	CONSTRAINT "driver_transfer_provider" CHECK ("driver_transfer_operations"."provider_transfer_id" is null or "driver_transfer_operations"."provider_transfer_id" ~ '^tr_[a-zA-Z0-9]{1,96}$'),
	CONSTRAINT "driver_transfer_attempt_frozen" CHECK (("driver_transfer_operations"."first_attempt_at" is null) = ("driver_transfer_operations"."charge_id" is null)),
	CONSTRAINT "driver_transfer_confirmation" CHECK (("driver_transfer_operations"."state" <> 'confirmed' or "driver_transfer_operations"."provider_transfer_id" is not null) and ("driver_transfer_operations"."provider_transfer_id" is null or "driver_transfer_operations"."first_attempt_at" is not null) and ("driver_transfer_operations"."state" <> 'canceled' or "driver_transfer_operations"."first_attempt_at" is null))
);
--> statement-breakpoint
ALTER TABLE "ledger_postings" DROP CONSTRAINT "ledger_valid_account";--> statement-breakpoint
ALTER TABLE "ledger_postings" DROP CONSTRAINT "ledger_scoped_owner";--> statement-breakpoint
ALTER TABLE "driver_transfer_operations" ADD CONSTRAINT "driver_transfer_operations_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_transfer_operations" ADD CONSTRAINT "driver_transfer_operations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_transfer_operations" ADD CONSTRAINT "driver_transfer_operations_payout_binding_id_driver_payout_accounts_id_fk" FOREIGN KEY ("payout_binding_id") REFERENCES "public"."driver_payout_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_transfer_operations" ADD CONSTRAINT "driver_transfer_operations_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_transfer_attempt" ON "driver_transfer_operations" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "driver_transfer_recovery" ON "driver_transfer_operations" USING btree ("requested_at","created_at");--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_valid_account" CHECK ("ledger_postings"."account" in ('stripe_clearing','rider_funds','driver_payable','platform_revenue','refund_suspense','processor_fees','dispute_suspense','platform_payment_losses','driver_transfer_pending'));--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_scoped_owner" CHECK (("ledger_postings"."account" in ('rider_funds','driver_payable','driver_transfer_pending')) = ("ledger_postings"."owner_id" is not null));--> statement-breakpoint
CREATE FUNCTION rove_preserve_transfer_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Transfer authorizations are immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.attempt_id,NEW.driver_id,NEW.payout_binding_id,NEW.account_id,NEW.authorized_by,NEW.amount_cents,NEW.policy_reference,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.attempt_id,OLD.driver_id,OLD.payout_binding_id,OLD.account_id,OLD.authorized_by,OLD.amount_cents,OLD.policy_reference,OLD.created_at)
 OR (OLD.first_attempt_at IS NOT NULL AND (NEW.first_attempt_at,NEW.charge_id) IS DISTINCT FROM (OLD.first_attempt_at,OLD.charge_id))
 OR (OLD.provider_transfer_id IS NOT NULL AND NEW.provider_transfer_id IS DISTINCT FROM OLD.provider_transfer_id)
 OR NEW.revision<OLD.revision OR NEW.reversed_cents<OLD.reversed_cents
 OR (OLD.state='canceled' AND NEW.state<>'canceled')
 OR (OLD.state='review_required' AND NEW.state='queued')
 THEN RAISE EXCEPTION 'Transfer authorization cannot be rewritten' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transfer_authorization_immutable BEFORE UPDATE OR DELETE ON driver_transfer_operations
FOR EACH ROW EXECUTE FUNCTION rove_preserve_transfer_authorization();
