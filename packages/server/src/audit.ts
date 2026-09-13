import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

/** Trusted backend only: callers authorize the event and supply their existing transaction. */
export async function appendAudit(
  client: PoolClient,
  actorId: string | null,
  action: string,
  aggregateId: string,
  metadata: string,
): Promise<void> {
  const id = randomUUID();
  const scope = JSON.stringify({
    id,
    actor: actorId,
    action,
    aggregate: aggregateId,
    metadata: JSON.parse(metadata),
  });
  await client.query("SELECT set_config('rove.audit_append',$1,true)", [scope]);
  await client.query(
    'INSERT INTO audit(id,actor_id,action,aggregate_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)',
    [id, actorId, action, aggregateId, metadata],
  );
  await client.query("SELECT set_config('rove.audit_append','',true)");
}
