CREATE TABLE "ledger_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"ride_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_transaction" text DEFAULT pg_current_xact_id()::text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_journals_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ledger_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"account" text NOT NULL,
	"owner_id" uuid,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "ledger_nonzero_amount" CHECK ("ledger_postings"."amount_cents" <> 0),
	CONSTRAINT "ledger_valid_account" CHECK ("ledger_postings"."account" in ('stripe_clearing','rider_funds','driver_payable','platform_revenue')),
	CONSTRAINT "ledger_scoped_owner" CHECK (("ledger_postings"."account" in ('rider_funds','driver_payable')) = ("ledger_postings"."owner_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_journal_id_ledger_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_postings_journal" ON "ledger_postings" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ledger_postings_owner_account" ON "ledger_postings" USING btree ("owner_id","account");--> statement-breakpoint
-- PostgreSQL enforces journal balance at commit, including journals created without any lines.
CREATE FUNCTION rove_check_ledger_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; total bigint; line_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'ledger_journals' THEN target_id := NEW.id; ELSE target_id := NEW.journal_id; END IF;
  SELECT COALESCE(SUM(amount_cents),0),COUNT(*) INTO total,line_count FROM ledger_postings WHERE journal_id=target_id;
  IF total <> 0 OR line_count < 2 THEN RAISE EXCEPTION 'Ledger journal must have balanced postings' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_header_balance AFTER INSERT ON ledger_journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rove_check_ledger_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_lines_balance AFTER INSERT ON ledger_postings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rove_check_ledger_balance();
--> statement-breakpoint
CREATE FUNCTION rove_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Committed ledger data is immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_header_immutable BEFORE UPDATE OR DELETE ON ledger_journals FOR EACH ROW EXECUTE FUNCTION rove_ledger_immutable();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_immutable BEFORE UPDATE OR DELETE ON ledger_postings FOR EACH ROW EXECUTE FUNCTION rove_ledger_immutable();
--> statement-breakpoint
CREATE FUNCTION rove_ledger_insert_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE creator text;
BEGIN
  SELECT created_transaction INTO creator FROM ledger_journals WHERE id=NEW.journal_id;
  IF creator IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'Ledger postings must be inserted with their journal' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_lines_insert_scope BEFORE INSERT ON ledger_postings FOR EACH ROW EXECUTE FUNCTION rove_ledger_insert_scope();
