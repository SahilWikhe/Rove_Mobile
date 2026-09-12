CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"support_request_id" uuid NOT NULL,
	"consent_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletion_consent" CHECK ("account_deletion_requests"."consent_version" = 'account-deletion-v1')
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_support_request_id_support_requests_id_fk" FOREIGN KEY ("support_request_id") REFERENCES "public"."support_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_owner" ON "account_deletion_requests" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_support" ON "account_deletion_requests" USING btree ("support_request_id");--> statement-breakpoint
CREATE FUNCTION protect_account_deletion_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Account deletion consent is immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM support_requests s JOIN users u ON u.id=s.owner_id
    WHERE s.id=NEW.support_request_id AND s.owner_id=NEW.owner_id
      AND s.category='account' AND u.role IN ('rider','driver') AND u.disabled=false
  ) THEN
    RAISE EXCEPTION 'Account deletion consent must reference its consumer account ticket';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_deletion_consent_immutable
BEFORE INSERT OR UPDATE OR DELETE ON account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION protect_account_deletion_consent();
