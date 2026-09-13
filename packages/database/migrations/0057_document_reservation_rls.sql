ALTER TABLE "driver_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "document_owner_read" ON "driver_documents" AS PERMISSIVE FOR SELECT TO public USING ("driver_documents"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "document_owner_insert" ON "driver_documents" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("driver_documents"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false) AND "driver_documents"."state"='reserved');--> statement-breakpoint
CREATE POLICY "document_owner_update" ON "driver_documents" AS PERMISSIVE FOR UPDATE TO public USING ("driver_documents"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false)) WITH CHECK ("driver_documents"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "document_staff_read" ON "driver_documents" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.document.review') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.eligibility.review') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup'));--> statement-breakpoint
CREATE POLICY "document_staff_lock" ON "driver_documents" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.document.review') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.eligibility.review') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup')) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "document_scanner_read" ON "driver_documents" AS PERMISSIVE FOR SELECT TO public USING (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND "driver_documents"."state"='quarantined' AND (current_setting('rove.scan_queue',true)='true' OR "driver_documents"."id"=NULLIF(current_setting('rove.scan_document',true),'')::uuid));--> statement-breakpoint
CREATE POLICY "document_cleanup_read" ON "driver_documents" AS PERMISSIVE FOR SELECT TO public USING (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND EXISTS(SELECT 1 FROM public.document_cleanup_items i JOIN public.document_cleanup_plans p ON p.id=i.plan_id WHERE i.id=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid AND p.owner_id="driver_documents"."driver_id"));--> statement-breakpoint
ALTER TABLE "driver_documents" FORCE ROW LEVEL SECURITY;
