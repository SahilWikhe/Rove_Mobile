ALTER TABLE "driver_document_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "document_review_owner_read" ON "driver_document_reviews" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role',true)='driver' AND EXISTS(SELECT 1 FROM public.driver_documents d JOIN public.users u ON u.id=d.driver_id WHERE d.id="driver_document_reviews"."document_id" AND d.driver_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='driver' AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "document_review_staff_read" ON "driver_document_reviews" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.document.review') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.eligibility.review'));--> statement-breakpoint
CREATE POLICY "document_review_staff_insert" ON "driver_document_reviews" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='driver.document.review') AND "driver_document_reviews"."reviewer_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "driver_document_reviews" FORCE ROW LEVEL SECURITY;
