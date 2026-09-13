ALTER TABLE "document_cleanup_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_cleanup_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cleanup_item_staff_read" ON "document_cleanup_items" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup'));--> statement-breakpoint
CREATE POLICY "cleanup_item_staff_insert" ON "document_cleanup_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup') AND "document_cleanup_items"."attempted_at" IS NULL AND "document_cleanup_items"."removed_at" IS NULL);--> statement-breakpoint
CREATE POLICY "cleanup_item_worker_read" ON "document_cleanup_items" AS PERMISSIVE FOR SELECT TO public USING (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND "document_cleanup_items"."id"=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "cleanup_item_worker_update" ON "document_cleanup_items" AS PERMISSIVE FOR UPDATE TO public USING (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND "document_cleanup_items"."id"=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid) WITH CHECK (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND "document_cleanup_items"."id"=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "cleanup_plan_staff_read" ON "document_cleanup_plans" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup'));--> statement-breakpoint
CREATE POLICY "cleanup_plan_staff_insert" ON "document_cleanup_plans" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup') AND "document_cleanup_plans"."created_by"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND "document_cleanup_plans"."approved_at" IS NULL);--> statement-breakpoint
CREATE POLICY "cleanup_plan_staff_approve" ON "document_cleanup_plans" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup')) WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup') AND "document_cleanup_plans"."approved_by"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND "document_cleanup_plans"."approved_at" IS NOT NULL);--> statement-breakpoint
CREATE POLICY "cleanup_plan_worker_read" ON "document_cleanup_plans" AS PERMISSIVE FOR SELECT TO public USING (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND EXISTS(SELECT 1 FROM public.document_cleanup_items i WHERE i.plan_id="document_cleanup_plans"."id" AND i.id=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid));
--> statement-breakpoint
ALTER TABLE "document_cleanup_plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_cleanup_items" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_document_cleanup_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan document_cleanup_plans%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cleanup item evidence is immutable'; END IF;
  SELECT * INTO plan FROM document_cleanup_plans WHERE id=NEW.plan_id;
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
