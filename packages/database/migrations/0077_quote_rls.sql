ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "quote_owner_read" ON "quotes" AS PERMISSIVE FOR SELECT TO public USING ("quotes"."rider_id"=NULLIF(current_setting('rove.quote_owner',true),'')::uuid AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="quotes"."rider_id" AND u.role='rider' AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "quote_owner_insert" ON "quotes" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("quotes"."rider_id"=NULLIF(current_setting('rove.quote_owner',true),'')::uuid AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="quotes"."rider_id" AND u.role='rider' AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "quote_owner_lock" ON "quotes" AS PERMISSIVE FOR UPDATE TO public USING ("quotes"."rider_id"=NULLIF(current_setting('rove.quote_owner',true),'')::uuid AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="quotes"."rider_id" AND u.role='rider' AND u.disabled=false)) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "quote_ride_read" ON "quotes" AS PERMISSIVE FOR SELECT TO public USING (EXISTS(SELECT 1 FROM public.rides r WHERE r.id=NULLIF(current_setting('rove.quote_ride',true),'')::uuid AND r.quote_id="quotes"."id"));
--> statement-breakpoint
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;
