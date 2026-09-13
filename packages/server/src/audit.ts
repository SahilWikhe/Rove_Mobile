import type { PoolClient } from 'pg';

/** Append inside the caller's transaction so the event and its audit record commit together. */
export async function appendAudit(
  client: PoolClient,
  actorId: string | null,
  action: string,
  aggregateId: string,
  metadata: string,
): Promise<void> {
  await client.query('INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,$2,$3,$4::jsonb)', [
    actorId,
    action,
    aggregateId,
    metadata,
  ]);
}
