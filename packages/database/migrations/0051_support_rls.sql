ALTER TABLE "support_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "support_owner_read" ON "support_requests" AS PERMISSIVE FOR SELECT TO public USING ("support_requests"."owner_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true) IN ('rider','driver')
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role=current_setting('rove.actor_role',true) AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "support_owner_insert" ON "support_requests" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("support_requests"."owner_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true) IN ('rider','driver')
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role=current_setting('rove.actor_role',true) AND u.disabled=false) AND "support_requests"."status"='open' AND "support_requests"."response" IS NULL AND "support_requests"."resolved_at" IS NULL AND "support_requests"."resolved_by" IS NULL);--> statement-breakpoint
CREATE POLICY "support_staff_read" ON "support_requests" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='support.read') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read'));--> statement-breakpoint
CREATE POLICY "support_staff_resolve" ON "support_requests" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='support.read') AND current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='support.resolve')) WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='support.read') AND current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='support.resolve') AND "support_requests"."status"='resolved' AND "support_requests"."resolved_by"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND "support_requests"."resolved_at" IS NOT NULL AND "support_requests"."response" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "support_requests" FORCE ROW LEVEL SECURITY;
