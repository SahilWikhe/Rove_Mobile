ALTER TABLE "account_closures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "closure_owner_read" ON "account_closures" AS PERMISSIVE FOR SELECT TO public USING ("account_closures"."owner_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true) IN ('rider','driver'));--> statement-breakpoint
CREATE POLICY "closure_staff_read" ON "account_closures" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.close') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.hold') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.release-hold'));--> statement-breakpoint
CREATE POLICY "closure_staff_insert" ON "account_closures" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.close') AND "account_closures"."authorized_by"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND "account_closures"."identity_attempted_at" IS NULL AND "account_closures"."identity_removed_at" IS NULL);--> statement-breakpoint
CREATE POLICY "closure_identity_read" ON "account_closures" AS PERMISSIVE FOR SELECT TO public USING (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND "account_closures"."request_id"=NULLIF(current_setting('rove.identity_request',true),'')::uuid AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="account_closures"."owner_id" AND u.disabled=true));--> statement-breakpoint
CREATE POLICY "closure_identity_update" ON "account_closures" AS PERMISSIVE FOR UPDATE TO public USING (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND "account_closures"."request_id"=NULLIF(current_setting('rove.identity_request',true),'')::uuid AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="account_closures"."owner_id" AND u.disabled=true)) WITH CHECK (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND "account_closures"."request_id"=NULLIF(current_setting('rove.identity_request',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "closure_cleanup_read" ON "account_closures" AS PERMISSIVE FOR SELECT TO public USING (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND EXISTS(SELECT 1 FROM public.document_cleanup_items i JOIN public.document_cleanup_plans p ON p.id=i.plan_id WHERE i.id=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid AND p.owner_id="account_closures"."owner_id"));--> statement-breakpoint
CREATE POLICY "closure_access_guard" ON "account_closures" AS PERMISSIVE FOR SELECT TO public USING ("account_closures"."owner_id"=NULLIF(current_setting('rove.closure_guard_owner',true),'')::uuid);--> statement-breakpoint
ALTER TABLE "account_closures" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_closed_account_access() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_scope text; is_closed boolean;
BEGIN
  previous_scope := current_setting('rove.closure_guard_owner',true);
  PERFORM set_config('rove.closure_guard_owner',OLD.id::text,true);
  SELECT EXISTS(SELECT 1 FROM public.account_closures WHERE owner_id=OLD.id) INTO is_closed;
  PERFORM set_config('rove.closure_guard_owner',COALESCE(previous_scope,''),true);
  IF is_closed AND (NEW.disabled=false OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.role IS DISTINCT FROM OLD.role)
  THEN RAISE EXCEPTION 'Closed account access cannot be restored'; END IF;
  RETURN NEW;
END $$;
