ALTER TABLE "retention_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "retention_staff_read" ON "retention_holds" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.hold') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.release-hold'));--> statement-breakpoint
CREATE POLICY "retention_staff_place" ON "retention_holds" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.hold') AND "retention_holds"."placed_by"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND "retention_holds"."released_at" IS NULL);--> statement-breakpoint
CREATE POLICY "retention_staff_release" ON "retention_holds" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.release-hold')) WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.release-hold') AND "retention_holds"."released_by"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND "retention_holds"."released_at" IS NOT NULL);--> statement-breakpoint
CREATE POLICY "retention_guard_read" ON "retention_holds" AS PERMISSIVE FOR SELECT TO public USING ("retention_holds"."owner_id"=NULLIF(current_setting('rove.retention_owner',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "retention_holds" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION public.has_active_retention_hold(target_owner uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE previous_scope text; held boolean;
BEGIN
  PERFORM id FROM public.users WHERE id=target_owner FOR UPDATE;
  previous_scope := current_setting('rove.retention_owner',true);
  PERFORM set_config('rove.retention_owner',target_owner::text,true);
  SELECT EXISTS(SELECT 1 FROM public.retention_holds WHERE owner_id=target_owner AND released_at IS NULL) INTO held;
  PERFORM set_config('rove.retention_owner',COALESCE(previous_scope,''),true);
  RETURN held;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_closure_retention_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.identity_attempted_at IS NOT NULL OR NEW.identity_removed_at IS NOT NULL
    THEN RAISE EXCEPTION 'New closure must precede identity dispatch'; END IF;
  ELSE
    IF OLD.identity_attempted_at IS NOT NULL AND NEW.identity_attempted_at IS DISTINCT FROM OLD.identity_attempted_at
    THEN RAISE EXCEPTION 'Identity dispatch evidence is immutable'; END IF;
    IF OLD.identity_removed_at IS NULL AND NEW.identity_removed_at IS NOT NULL AND NEW.identity_attempted_at IS NULL
    THEN RAISE EXCEPTION 'Identity removal requires dispatch evidence'; END IF;
  END IF;
  IF NEW.identity_attempted_at < NEW.closed_at
  THEN RAISE EXCEPTION 'Identity dispatch must follow closure'; END IF;
  IF TG_OP='INSERT' OR NEW.identity_attempted_at IS DISTINCT FROM OLD.identity_attempted_at THEN
    PERFORM id FROM users WHERE id=NEW.owner_id FOR UPDATE;
    IF public.has_active_retention_hold(NEW.owner_id)
    THEN RAISE EXCEPTION 'Active retention hold blocks account closure or identity dispatch'; END IF;
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_document_cleanup_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cleanup plan evidence is immutable'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.document_id,NEW.owner_id,NEW.manifest_hash,NEW.delete_markers,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.document_id,OLD.owner_id,OLD.manifest_hash,OLD.delete_markers,OLD.created_by,OLD.created_at)
      OR (OLD.approved_at IS NOT NULL AND (NEW.approved_by,NEW.approved_at,NEW.not_before,NEW.policy_reference,NEW.review_reference,NEW.quiescence_reference) IS DISTINCT FROM (OLD.approved_by,OLD.approved_at,OLD.not_before,OLD.policy_reference,OLD.review_reference,OLD.quiescence_reference))
    THEN RAISE EXCEPTION 'Cleanup plan evidence is immutable'; END IF;
  ELSIF NEW.approved_at IS NOT NULL THEN RAISE EXCEPTION 'New cleanup plans must be drafts'; END IF;
  PERFORM u.id FROM users u JOIN account_closures a ON a.owner_id=u.id JOIN driver_documents d ON d.driver_id=u.id WHERE u.id=NEW.owner_id AND u.disabled AND d.id=NEW.document_id FOR UPDATE OF u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup requires owned document and closed account'; END IF;
  IF public.has_active_retention_hold(NEW.owner_id) THEN RAISE EXCEPTION 'Cleanup retention hold'; END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_document_cleanup_item() RETURNS trigger LANGUAGE plpgsql AS $$
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
      IF public.has_active_retention_hold(plan.owner_id) THEN RAISE EXCEPTION 'Cleanup retention hold'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
