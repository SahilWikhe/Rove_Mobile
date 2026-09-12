ALTER TABLE ledger_postings DROP CONSTRAINT ledger_valid_account;
--> statement-breakpoint
ALTER TABLE ledger_postings ADD CONSTRAINT ledger_valid_account CHECK (account IN ('stripe_clearing','rider_funds','driver_payable','platform_revenue','refund_suspense','processor_fees'));
