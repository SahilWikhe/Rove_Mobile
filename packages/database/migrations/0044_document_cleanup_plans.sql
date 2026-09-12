CREATE TABLE "document_cleanup_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"object_version" text NOT NULL,
	"attempted_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "document_cleanup_version_id" CHECK (length("document_cleanup_items"."object_version") between 1 and 1024 and "document_cleanup_items"."object_version"<>'null'),
	CONSTRAINT "document_cleanup_removal" CHECK ("document_cleanup_items"."removed_at" is null or ("document_cleanup_items"."attempted_at" is not null and "document_cleanup_items"."removed_at">="document_cleanup_items"."attempted_at"))
);
--> statement-breakpoint
CREATE TABLE "document_cleanup_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"manifest_hash" text NOT NULL,
	"delete_markers" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"not_before" timestamp with time zone,
	"policy_reference" text,
	"review_reference" text,
	"quiescence_reference" text,
	CONSTRAINT "document_cleanup_hash" CHECK ("document_cleanup_plans"."manifest_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "document_cleanup_markers" CHECK ("document_cleanup_plans"."delete_markers" >= 0),
	CONSTRAINT "document_cleanup_approval" CHECK (("document_cleanup_plans"."approved_at" is null and "document_cleanup_plans"."approved_by" is null and "document_cleanup_plans"."not_before" is null and "document_cleanup_plans"."policy_reference" is null and "document_cleanup_plans"."review_reference" is null and "document_cleanup_plans"."quiescence_reference" is null) or ("document_cleanup_plans"."approved_at" is not null and "document_cleanup_plans"."approved_at">="document_cleanup_plans"."created_at" and "document_cleanup_plans"."approved_by" is not null and "document_cleanup_plans"."not_before" is not null and "document_cleanup_plans"."policy_reference" is not null and "document_cleanup_plans"."review_reference" is not null and "document_cleanup_plans"."quiescence_reference" is not null and length("document_cleanup_plans"."policy_reference") between 1 and 128 and length("document_cleanup_plans"."review_reference") between 1 and 128 and length("document_cleanup_plans"."quiescence_reference") between 1 and 128))
);
--> statement-breakpoint
ALTER TABLE "document_cleanup_items" ADD CONSTRAINT "document_cleanup_items_plan_id_document_cleanup_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."document_cleanup_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_cleanup_plans" ADD CONSTRAINT "document_cleanup_plans_document_id_driver_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."driver_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_cleanup_plans" ADD CONSTRAINT "document_cleanup_plans_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_cleanup_plans" ADD CONSTRAINT "document_cleanup_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_cleanup_plans" ADD CONSTRAINT "document_cleanup_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_cleanup_version" ON "document_cleanup_items" USING btree ("plan_id","object_key","object_version");--> statement-breakpoint
CREATE FUNCTION protect_document_cleanup_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cleanup plan evidence is immutable'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.document_id,NEW.owner_id,NEW.manifest_hash,NEW.delete_markers,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.document_id,OLD.owner_id,OLD.manifest_hash,OLD.delete_markers,OLD.created_by,OLD.created_at)
      OR (OLD.approved_at IS NOT NULL AND (NEW.approved_by,NEW.approved_at,NEW.not_before,NEW.policy_reference,NEW.review_reference,NEW.quiescence_reference) IS DISTINCT FROM (OLD.approved_by,OLD.approved_at,OLD.not_before,OLD.policy_reference,OLD.review_reference,OLD.quiescence_reference))
    THEN RAISE EXCEPTION 'Cleanup plan evidence is immutable'; END IF;
  ELSIF NEW.approved_at IS NOT NULL THEN RAISE EXCEPTION 'New cleanup plans must be drafts'; END IF;
  PERFORM u.id FROM users u JOIN account_closures a ON a.owner_id=u.id JOIN driver_documents d ON d.driver_id=u.id WHERE u.id=NEW.owner_id AND u.disabled AND d.id=NEW.document_id FOR UPDATE OF u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup requires owned document and closed account'; END IF;
  IF EXISTS(SELECT 1 FROM retention_holds WHERE owner_id=NEW.owner_id AND released_at IS NULL) THEN RAISE EXCEPTION 'Cleanup retention hold'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_cleanup_plan_evidence BEFORE INSERT OR UPDATE OR DELETE ON document_cleanup_plans FOR EACH ROW EXECUTE FUNCTION protect_document_cleanup_plan();
--> statement-breakpoint
CREATE FUNCTION protect_document_cleanup_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan document_cleanup_plans%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cleanup item evidence is immutable'; END IF;
  SELECT * INTO plan FROM document_cleanup_plans WHERE id=NEW.plan_id FOR SHARE;
  IF TG_OP='INSERT' THEN
    IF plan.created_at<>transaction_timestamp() OR plan.approved_at IS NOT NULL OR NEW.attempted_at IS NOT NULL OR NEW.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Cleanup items must precede approval'; END IF;
    IF NEW.object_key !~ ('^driver-documents/(inbox|quarantine)/' || plan.document_id::text || '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN RAISE EXCEPTION 'Cleanup item scope mismatch'; END IF;
  ELSE
    IF (NEW.id,NEW.plan_id,NEW.object_key,NEW.object_version) IS DISTINCT FROM (OLD.id,OLD.plan_id,OLD.object_key,OLD.object_version)
      OR (OLD.attempted_at IS NOT NULL AND NEW.attempted_at IS DISTINCT FROM OLD.attempted_at)
      OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS DISTINCT FROM OLD.removed_at)
    THEN RAISE EXCEPTION 'Cleanup item evidence is immutable'; END IF;
    IF NEW.attempted_at IS DISTINCT FROM OLD.attempted_at THEN
      PERFORM id FROM users WHERE id=plan.owner_id AND disabled FOR UPDATE;
      IF NOT FOUND OR plan.approved_at IS NULL OR plan.not_before>clock_timestamp() THEN RAISE EXCEPTION 'Cleanup is not authorized'; END IF;
      IF EXISTS(SELECT 1 FROM retention_holds WHERE owner_id=plan.owner_id AND released_at IS NULL) THEN RAISE EXCEPTION 'Cleanup retention hold'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_cleanup_item_evidence BEFORE INSERT OR UPDATE OR DELETE ON document_cleanup_items FOR EACH ROW EXECUTE FUNCTION protect_document_cleanup_item();
