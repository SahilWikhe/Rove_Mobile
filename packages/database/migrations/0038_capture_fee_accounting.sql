CREATE TABLE "payment_capture_checks" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"charge_id" text,
	"balance_id" text,
	"amount_cents" integer,
	"fee_cents" integer,
	"net_cents" integer,
	"journal_id" uuid,
	"verified_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"requested_at" timestamp with time zone,
	"review_required" boolean DEFAULT false NOT NULL,
	CONSTRAINT "payment_capture_checks_journalId_unique" UNIQUE("journal_id"),
	CONSTRAINT "capture_check_revision" CHECK ("payment_capture_checks"."revision" >= 0),
	CONSTRAINT "capture_check_source" CHECK ("payment_capture_checks"."source" ~ '^acct_[a-zA-Z0-9]{1,96}:(test|live)$'),
	CONSTRAINT "capture_check_facts" CHECK ((
      "payment_capture_checks"."charge_id" is null and "payment_capture_checks"."balance_id" is null and "payment_capture_checks"."amount_cents" is null and "payment_capture_checks"."fee_cents" is null and "payment_capture_checks"."net_cents" is null and "payment_capture_checks"."journal_id" is null and "payment_capture_checks"."verified_at" is null
    ) or (
      "payment_capture_checks"."charge_id" is not null and "payment_capture_checks"."charge_id" ~ '^ch_[a-zA-Z0-9]{1,96}$' and "payment_capture_checks"."balance_id" is not null and "payment_capture_checks"."balance_id" ~ '^txn_[a-zA-Z0-9]{1,96}$'
      and "payment_capture_checks"."amount_cents" is not null and "payment_capture_checks"."amount_cents" between 1 and 99999999
      and "payment_capture_checks"."fee_cents" is not null and "payment_capture_checks"."fee_cents" between 0 and "payment_capture_checks"."amount_cents"
      and "payment_capture_checks"."net_cents" is not null and "payment_capture_checks"."net_cents" = "payment_capture_checks"."amount_cents" - "payment_capture_checks"."fee_cents"
      and "payment_capture_checks"."verified_at" is not null and (("payment_capture_checks"."fee_cents" = 0 and "payment_capture_checks"."journal_id" is null) or ("payment_capture_checks"."fee_cents" > 0 and "payment_capture_checks"."journal_id" is not null))
    ))
);
--> statement-breakpoint
ALTER TABLE "payment_capture_checks" ADD CONSTRAINT "payment_capture_checks_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_capture_checks" ADD CONSTRAINT "payment_capture_checks_journal_id_ledger_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capture_balance_source" ON "payment_capture_checks" USING btree ("source","balance_id");--> statement-breakpoint
CREATE FUNCTION rove_preserve_capture_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'Capture balance bindings are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR NEW.source IS DISTINCT FROM OLD.source OR NEW.revision < OLD.revision
 OR (OLD.balance_id IS NOT NULL AND ROW(NEW.charge_id,NEW.balance_id,NEW.amount_cents,NEW.fee_cents,NEW.net_cents,NEW.journal_id) IS DISTINCT FROM ROW(OLD.charge_id,OLD.balance_id,OLD.amount_cents,OLD.fee_cents,OLD.net_cents,OLD.journal_id))
 OR (OLD.review_required AND NOT NEW.review_required) THEN
  RAISE EXCEPTION 'Capture balance facts require review' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER capture_check_immutable BEFORE UPDATE OR DELETE ON payment_capture_checks
FOR EACH ROW EXECUTE FUNCTION rove_preserve_capture_check();
