CREATE TABLE "payment_loss_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"authorized_by" uuid NOT NULL,
	"policy_reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_loss_allocations_journalId_unique" UNIQUE("journal_id"),
	CONSTRAINT "loss_policy_reference" CHECK (length("payment_loss_allocations"."policy_reference") between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "ledger_postings" DROP CONSTRAINT "ledger_valid_account";
--> statement-breakpoint
ALTER TABLE "payment_loss_allocations" ADD CONSTRAINT "payment_loss_allocations_journal_id_ledger_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_loss_allocations" ADD CONSTRAINT "payment_loss_allocations_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_valid_account" CHECK ("ledger_postings"."account" in ('stripe_clearing','rider_funds','driver_payable','platform_revenue','refund_suspense','processor_fees','dispute_suspense','platform_payment_losses'));
--> statement-breakpoint
CREATE FUNCTION rove_preserve_loss_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payment loss allocations are immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER loss_allocation_immutable BEFORE UPDATE OR DELETE ON payment_loss_allocations
FOR EACH ROW EXECUTE FUNCTION rove_preserve_loss_allocation();
