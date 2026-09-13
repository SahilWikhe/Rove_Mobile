ALTER TABLE "trip_message_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_message_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "message_reads_owner" ON "trip_message_reads" AS PERMISSIVE FOR ALL TO public USING ("trip_message_reads"."owner_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND EXISTS (
  SELECT 1 FROM public.offers o JOIN public.rides r ON r.id=o.ride_id
  JOIN public.users rider ON rider.id=r.rider_id JOIN public.users driver ON driver.id=o.driver_id
  WHERE o.id="trip_message_reads"."offer_id" AND o.status='accepted' AND r.driver_id=o.driver_id
    AND rider.disabled=false AND driver.disabled=false
    AND ((current_setting('rove.actor_role',true)='rider' AND r.rider_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid)
      OR (current_setting('rove.actor_role',true)='driver' AND o.driver_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid))
    AND (r.state IN ('matched','en_route','arrived','in_progress','interrupted') OR r.updated_at>now()-interval '30 days')
)) WITH CHECK ("trip_message_reads"."owner_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND EXISTS (
  SELECT 1 FROM public.offers o JOIN public.rides r ON r.id=o.ride_id
  JOIN public.users rider ON rider.id=r.rider_id JOIN public.users driver ON driver.id=o.driver_id
  WHERE o.id="trip_message_reads"."offer_id" AND o.status='accepted' AND r.driver_id=o.driver_id
    AND rider.disabled=false AND driver.disabled=false
    AND ((current_setting('rove.actor_role',true)='rider' AND r.rider_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid)
      OR (current_setting('rove.actor_role',true)='driver' AND o.driver_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid))
    AND (r.state IN ('matched','en_route','arrived','in_progress','interrupted') OR r.updated_at>now()-interval '30 days')
));--> statement-breakpoint
CREATE POLICY "message_reads_notification" ON "trip_message_reads" AS PERMISSIVE FOR SELECT TO public USING (
  COALESCE(current_setting('rove.actor_id',true),'')='' AND "trip_message_reads"."offer_id"=NULLIF(current_setting('rove.notification_offer',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "message_reads_privacy" ON "trip_message_reads" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read'));--> statement-breakpoint
CREATE POLICY "message_reports_participant_read" ON "trip_message_reports" AS PERMISSIVE FOR SELECT TO public USING (EXISTS (
  SELECT 1 FROM public.offers o JOIN public.rides r ON r.id=o.ride_id
  JOIN public.users rider ON rider.id=r.rider_id JOIN public.users driver ON driver.id=o.driver_id
  WHERE o.id="trip_message_reports"."offer_id" AND o.status='accepted' AND r.driver_id=o.driver_id
    AND rider.disabled=false AND driver.disabled=false
    AND ((current_setting('rove.actor_role',true)='rider' AND r.rider_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid)
      OR (current_setting('rove.actor_role',true)='driver' AND o.driver_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid))
    AND (r.state IN ('matched','en_route','arrived','in_progress','interrupted') OR r.updated_at>now()-interval '30 days')
));--> statement-breakpoint
CREATE POLICY "message_reports_participant_insert" ON "trip_message_reports" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("trip_message_reports"."reporter_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND EXISTS (
  SELECT 1 FROM public.offers o JOIN public.rides r ON r.id=o.ride_id
  JOIN public.users rider ON rider.id=r.rider_id JOIN public.users driver ON driver.id=o.driver_id
  WHERE o.id="trip_message_reports"."offer_id" AND o.status='accepted' AND r.driver_id=o.driver_id
    AND rider.disabled=false AND driver.disabled=false
    AND ((current_setting('rove.actor_role',true)='rider' AND r.rider_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid)
      OR (current_setting('rove.actor_role',true)='driver' AND o.driver_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid))
    AND (r.state IN ('matched','en_route','arrived','in_progress','interrupted') OR r.updated_at>now()-interval '30 days')
) AND EXISTS(SELECT 1 FROM public.support_requests s WHERE s.id="trip_message_reports"."support_id" AND s.owner_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "message_reports_privacy" ON "trip_message_reports" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read') OR current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup'));--> statement-breakpoint
CREATE POLICY "message_reports_notification" ON "trip_message_reports" AS PERMISSIVE FOR SELECT TO public USING (
  COALESCE(current_setting('rove.actor_id',true),'')='' AND "trip_message_reports"."offer_id"=NULLIF(current_setting('rove.notification_offer',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "messages_participant_read" ON "trip_messages" AS PERMISSIVE FOR SELECT TO public USING (EXISTS (
  SELECT 1 FROM public.offers o JOIN public.rides r ON r.id=o.ride_id
  JOIN public.users rider ON rider.id=r.rider_id JOIN public.users driver ON driver.id=o.driver_id
  WHERE o.id="trip_messages"."offer_id" AND o.status='accepted' AND r.driver_id=o.driver_id
    AND rider.disabled=false AND driver.disabled=false
    AND ((current_setting('rove.actor_role',true)='rider' AND r.rider_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid)
      OR (current_setting('rove.actor_role',true)='driver' AND o.driver_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid))
    AND (r.state IN ('matched','en_route','arrived','in_progress','interrupted') OR r.updated_at>now()-interval '30 days')
));--> statement-breakpoint
CREATE POLICY "messages_participant_send" ON "trip_messages" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("trip_messages"."sender_id"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND EXISTS (
  SELECT 1 FROM public.offers o JOIN public.rides r ON r.id=o.ride_id
  JOIN public.users rider ON rider.id=r.rider_id JOIN public.users driver ON driver.id=o.driver_id
  WHERE o.id="trip_messages"."offer_id" AND o.status='accepted' AND r.driver_id=o.driver_id
    AND rider.disabled=false AND driver.disabled=false
    AND ((current_setting('rove.actor_role',true)='rider' AND r.rider_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid)
      OR (current_setting('rove.actor_role',true)='driver' AND o.driver_id=NULLIF(current_setting('rove.actor_id', true), '')::uuid))
    AND r.state IN ('matched','en_route','arrived','in_progress','interrupted')
) AND NOT EXISTS(SELECT 1 FROM public.trip_message_reports p WHERE p.offer_id="trip_messages"."offer_id"));--> statement-breakpoint
CREATE POLICY "messages_privacy_read" ON "trip_messages" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.read'));--> statement-breakpoint
CREATE POLICY "messages_cleanup_read" ON "trip_messages" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup') AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="trip_messages"."sender_id" AND u.disabled=true));--> statement-breakpoint
CREATE POLICY "messages_cleanup_delete" ON "trip_messages" AS PERMISSIVE FOR DELETE TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='privacy.cleanup') AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="trip_messages"."sender_id" AND u.disabled=true));--> statement-breakpoint
CREATE POLICY "messages_notification_read" ON "trip_messages" AS PERMISSIVE FOR SELECT TO public USING (
  COALESCE(current_setting('rove.actor_id',true),'')='' AND "trip_messages"."id"=NULLIF(current_setting('rove.notification_message',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE trip_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE trip_message_reads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE trip_message_reports FORCE ROW LEVEL SECURITY;
