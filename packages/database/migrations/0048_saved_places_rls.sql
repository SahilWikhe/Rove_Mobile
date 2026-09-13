ALTER TABLE "saved_places" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "saved_places_owner" ON "saved_places" AS PERMISSIVE FOR ALL TO public USING ("saved_places"."rider_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='rider'
        AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='rider' AND u.disabled=false)) WITH CHECK ("saved_places"."rider_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='rider'
        AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='rider' AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "saved_places_privacy_read" ON "saved_places" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read'));--> statement-breakpoint
CREATE POLICY "saved_places_closure_read" ON "saved_places" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.close') AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="saved_places"."rider_id" AND u.disabled=true));--> statement-breakpoint
CREATE POLICY "saved_places_closure_delete" ON "saved_places" AS PERMISSIVE FOR DELETE TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.close') AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="saved_places"."rider_id" AND u.disabled=true));
--> statement-breakpoint
-- Drizzle models ENABLE and policies; FORCE is an additional reviewed SQL safeguard.
ALTER TABLE "saved_places" FORCE ROW LEVEL SECURITY;
