ALTER TABLE "payment_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payout_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payment_webhook_read" ON "payment_webhook_events" AS PERMISSIVE FOR SELECT TO public USING ("payment_webhook_events"."source"=current_setting('rove.payment_webhook_source',true) AND "payment_webhook_events"."event_id"=current_setting('rove.payment_webhook_event',true));--> statement-breakpoint
CREATE POLICY "payment_webhook_insert" ON "payment_webhook_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("payment_webhook_events"."source"=current_setting('rove.payment_webhook_source',true) AND "payment_webhook_events"."event_id"=current_setting('rove.payment_webhook_event',true));--> statement-breakpoint
CREATE POLICY "payout_webhook_read" ON "payout_webhook_events" AS PERMISSIVE FOR SELECT TO public USING ("payout_webhook_events"."source"=current_setting('rove.payout_webhook_source',true) AND "payout_webhook_events"."event_id"=current_setting('rove.payout_webhook_event',true));--> statement-breakpoint
CREATE POLICY "payout_webhook_insert" ON "payout_webhook_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("payout_webhook_events"."source"=current_setting('rove.payout_webhook_source',true) AND "payout_webhook_events"."event_id"=current_setting('rove.payout_webhook_event',true));
--> statement-breakpoint
ALTER TABLE "payment_webhook_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payout_webhook_events" FORCE ROW LEVEL SECURITY;
