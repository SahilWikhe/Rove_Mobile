import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { Actor } from './rides';
import { DomainError } from './errors';
import { transaction } from './transactions';

const identity = z.object({
  id: z.uuid(),
  role: z.enum(['rider', 'driver', 'staff']),
  mfa: z.boolean().optional(),
});

/** Backend-only identity; never construct from unverified request headers or client payloads. */
export async function actorTransaction<T>(
  pool: Pool,
  actor: Actor,
  work: (client: PoolClient) => Promise<T>,
  ownerLock: 'share' | 'update' = 'share',
): Promise<T> {
  return transaction(pool, async (client) => {
    await bindActorIdentity(client, actor, ownerLock);
    return work(client);
  });
}

/** Only call within an already-open transaction; identity never survives that transaction. */
export async function bindActorIdentity(
  client: PoolClient,
  actor: Actor,
  ownerLock: 'share' | 'update' = 'share',
) {
  const parsed = identity.safeParse(actor);
  if (!parsed.success) throw new DomainError('FORBIDDEN', 'A verified account is required.', 403);
  // Every field is reset first, even when a connection had unexpected session settings.
  await client.query(`SELECT set_config('rove.actor_id','',true),
      set_config('rove.actor_role','',true),set_config('rove.actor_mfa','false',true),set_config('rove.payment_webhook_source','',true),set_config('rove.payment_webhook_event','',true),set_config('rove.payout_webhook_source','',true),set_config('rove.payout_webhook_event','',true),set_config('rove.payout_source','',true),set_config('rove.payout_driver','',true),set_config('rove.payout_account','',true),set_config('rove.payout_binding','',true),set_config('rove.payout_result','',true),set_config('rove.payout_sweep','false',true),set_config('rove.transfer_source','',true),set_config('rove.transfer_attempt','',true),set_config('rove.transfer_read','',true),set_config('rove.transfer_write','',true),set_config('rove.transfer_sweep','false',true),set_config('rove.transfer_balance','',true),set_config('rove.transfer_closure_owner','',true),set_config('rove.loss_source','',true),set_config('rove.loss_attempt','',true),set_config('rove.loss_journal','',true),set_config('rove.refund_operation_source','',true),set_config('rove.refund_operation_attempt','',true),set_config('rove.refund_operation_read','',true),set_config('rove.refund_operation_write','',true),set_config('rove.refund_closure_owner','',true),set_config('rove.dispute_source','',true),set_config('rove.dispute_read','',true),set_config('rove.dispute_write','',true),set_config('rove.dispute_sweep','false',true),set_config('rove.refund_source','',true),set_config('rove.refund_read','',true),set_config('rove.refund_write','',true),set_config('rove.refund_sweep','false',true),set_config('rove.customer_source','',true),set_config('rove.customer_read','',true),set_config('rove.customer_write','',true),set_config('rove.customer_result','',true),set_config('rove.capture_source','',true),set_config('rove.capture_write','',true),set_config('rove.capture_read','',true),set_config('rove.capture_sweep','false',true),set_config('rove.capture_balance','',true),set_config('rove.install_project','',true),set_config('rove.install_lookup','',true),set_config('rove.install_token','',true),set_config('rove.install_target','',true),set_config('rove.install_revision','',true),set_config('rove.audience_rider','',true),set_config('rove.audience_rider_project','',true),set_config('rove.audience_driver','',true),set_config('rove.audience_driver_project','',true),set_config('rove.push_event','',true),set_config('rove.push_installation','',true),set_config('rove.push_revision','',true),set_config('rove.push_delivery','',true),set_config('rove.push_recovery_at','',true),set_config('rove.push_rate_project','',true),set_config('rove.rate_key','',true),set_config('rove.rate_prune','false',true),set_config('rove.write_document','',true),set_config('rove.write_key','',true),
      set_config('rove.notification_message','',true),set_config('rove.notification_offer','',true),set_config('rove.identity_request','',true),set_config('rove.cleanup_item','',true),set_config('rove.closure_guard_owner','',true),set_config('rove.retention_owner','',true),set_config('rove.scan_queue','false',true),set_config('rove.scan_document','',true)`);
  const owner = await client.query(
    `SELECT id FROM users WHERE id=$1 AND role=$2 AND disabled=false ${ownerLock === 'update' ? 'FOR UPDATE' : 'FOR SHARE'}`,
    [parsed.data.id, parsed.data.role],
  );
  if (!owner.rowCount) throw new DomainError('FORBIDDEN', 'Account is unavailable.', 403);
  await client.query(
    `SELECT set_config('rove.actor_id',$1,true),
      set_config('rove.actor_role',$2,true),set_config('rove.actor_mfa',$3,true)`,
    [parsed.data.id, parsed.data.role, parsed.data.mfa === true ? 'true' : 'false'],
  );
}
