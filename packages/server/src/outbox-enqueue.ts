import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

interface OutboxAppend {
  topic: string;
  aggregateId: string;
  /** Serialized JSON, preserving the callers' existing wire payloads. */
  payload: string;
  dedupeKey: string;
  availableAt?: Date | string | null;
  ignoreDuplicate?: boolean;
}

/** Trusted backend only: authorize first and use the domain mutation's transaction. */
export async function enqueueOutbox(client: PoolClient, input: OutboxAppend) {
  const id = randomUUID();
  const availableAt = input.availableAt ?? null;
  const scope = JSON.stringify({
    id,
    topic: input.topic,
    aggregate: input.aggregateId,
    payload: JSON.parse(input.payload),
    key: input.dedupeKey,
    available: availableAt,
  });
  await client.query("SELECT set_config('rove.outbox_append',$1,true)", [scope]);
  const statement =
    'INSERT INTO outbox(id,topic,aggregate_id,payload,dedupe_key,available_at) VALUES($1,$2,$3,$4::jsonb,$5,COALESCE($6::timestamptz,now()))';
  const result = await client.query(
    input.ignoreDuplicate ? statement + ' ON CONFLICT(dedupe_key) DO NOTHING' : statement,
    [id, input.topic, input.aggregateId, input.payload, input.dedupeKey, availableAt],
  );
  await client.query("SELECT set_config('rove.outbox_append','',true)");
  return result;
}
