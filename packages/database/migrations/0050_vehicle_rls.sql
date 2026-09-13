ALTER TABLE "driver_vehicle_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "driver_vehicle_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_review_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "vehicle_history_read" ON "driver_vehicle_history" AS PERMISSIVE FOR SELECT TO public USING ("driver_vehicle_history"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false) OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.vehicle.review'));--> statement-breakpoint
CREATE POLICY "vehicle_history_insert" ON "driver_vehicle_history" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("driver_vehicle_history"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "vehicle_submission_read" ON "driver_vehicle_submissions" AS PERMISSIVE FOR SELECT TO public USING ("driver_vehicle_submissions"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false) OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.vehicle.review') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.eligibility.review'));--> statement-breakpoint
CREATE POLICY "vehicle_submission_insert" ON "driver_vehicle_submissions" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("driver_vehicle_submissions"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false) AND "driver_vehicle_submissions"."status"='pending');--> statement-breakpoint
CREATE POLICY "vehicle_submission_update" ON "driver_vehicle_submissions" AS PERMISSIVE FOR UPDATE TO public USING ("driver_vehicle_submissions"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false) OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.vehicle.review')) WITH CHECK (("driver_vehicle_submissions"."driver_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false) AND "driver_vehicle_submissions"."status"='pending') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.vehicle.review'));--> statement-breakpoint
CREATE POLICY "vehicle_decision_read" ON "vehicle_review_decisions" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.vehicle.review') OR EXISTS(SELECT 1 FROM public.driver_vehicle_history h WHERE h.revision="vehicle_review_decisions"."revision" AND h.driver_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND current_setting('rove.actor_role',true)='driver'));--> statement-breakpoint
CREATE POLICY "vehicle_decision_insert" ON "vehicle_review_decisions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.vehicle.review') AND "vehicle_review_decisions"."reviewer_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "driver_vehicle_submissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "driver_vehicle_history" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vehicle_review_decisions" FORCE ROW LEVEL SECURITY;
