ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deletion_owner_read" ON "account_deletion_requests" AS PERMISSIVE FOR SELECT TO public USING ("account_deletion_requests"."owner_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true) IN ('rider','driver')
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role=current_setting('rove.actor_role',true) AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "deletion_owner_insert" ON "account_deletion_requests" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("account_deletion_requests"."owner_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true) IN ('rider','driver')
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role=current_setting('rove.actor_role',true) AND u.disabled=false) AND "account_deletion_requests"."withdrawn_at" IS NULL);--> statement-breakpoint
CREATE POLICY "deletion_owner_withdraw" ON "account_deletion_requests" AS PERMISSIVE FOR UPDATE TO public USING ("account_deletion_requests"."owner_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true) IN ('rider','driver')
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role=current_setting('rove.actor_role',true) AND u.disabled=false)) WITH CHECK ("account_deletion_requests"."owner_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true) IN ('rider','driver')
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role=current_setting('rove.actor_role',true) AND u.disabled=false) AND "account_deletion_requests"."withdrawn_at" IS NOT NULL);--> statement-breakpoint
CREATE POLICY "deletion_staff_read" ON "account_deletion_requests" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.close') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup'));--> statement-breakpoint
CREATE POLICY "deletion_identity_read" ON "account_deletion_requests" AS PERMISSIVE FOR SELECT TO public USING (NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND "account_deletion_requests"."id"=NULLIF(current_setting('rove.identity_request',true),'')::uuid AND EXISTS(SELECT 1 FROM public.account_closures c JOIN public.users u ON u.id=c.owner_id WHERE c.request_id="account_deletion_requests"."id" AND c.owner_id="account_deletion_requests"."owner_id" AND u.disabled=true));--> statement-breakpoint
ALTER TABLE "account_deletion_requests" FORCE ROW LEVEL SECURITY;
