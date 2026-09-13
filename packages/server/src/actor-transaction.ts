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
      set_config('rove.actor_role','',true),set_config('rove.actor_mfa','false',true),set_config('rove.write_document','',true),set_config('rove.write_key','',true),
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
