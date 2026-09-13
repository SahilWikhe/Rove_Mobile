ALTER TABLE "payment_loss_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "loss_allocation_read" ON "payment_loss_allocations" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='payments.loss.allocate') AND EXISTS(SELECT 1 FROM public.ledger_journals j JOIN public.payment_attempts p ON p.id=j.attempt_id WHERE j.id="payment_loss_allocations"."journal_id" AND j.kind IN ('refund_loss_allocation','dispute_loss_allocation') AND p.source=current_setting('rove.loss_source',true) AND p.id=NULLIF(current_setting('rove.loss_attempt',true),'')::uuid));--> statement-breakpoint
CREATE POLICY "loss_allocation_authorize" ON "payment_loss_allocations" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND u.role='staff' AND u.disabled=false AND p.permission='payments.loss.allocate') AND "payment_loss_allocations"."authorized_by"=NULLIF(current_setting('rove.actor_id', true), '')::uuid AND EXISTS(SELECT 1 FROM public.ledger_journals j JOIN public.payment_attempts p ON p.id=j.attempt_id WHERE j.id="payment_loss_allocations"."journal_id" AND j.kind IN ('refund_loss_allocation','dispute_loss_allocation') AND p.source=current_setting('rove.loss_source',true) AND p.id=NULLIF(current_setting('rove.loss_attempt',true),'')::uuid) AND "payment_loss_allocations"."journal_id"=NULLIF(current_setting('rove.loss_journal',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "payment_loss_allocations" FORCE ROW LEVEL SECURITY;
