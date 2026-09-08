import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DomainError } from './errors';

export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new DomainError(
        'CONFLICT',
        'Another request already changed this resource. Refresh and try again.',
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Serializes retries by actor/key; command result and mutations commit together. */
export async function command<T>(
  pool: Pool,
  actorId: string,
  key: string,
  input: unknown,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    throw new DomainError('INVALID_IDEMPOTENCY_KEY', 'Use a unique request key.', 400);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actorId}:${key}`]);
    const existing = await client.query<{ fingerprint: string; result: T }>(
      'SELECT fingerprint, result FROM commands WHERE actor_id=$1 AND key=$2',
      [actorId, key],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].fingerprint !== fingerprint)
        throw new DomainError(
          'IDEMPOTENCY_CONFLICT',
          'This request key has already been used for a different action.',
        );
      return existing.rows[0].result;
    }
    const result = await work(client);
    await client.query('INSERT INTO commands (actor_id,key,fingerprint,result) VALUES ($1,$2,$3,$4)', [
      actorId,
      key,
      fingerprint,
      JSON.stringify(result),
    ]);
    return result;
  });
}

export async function event(
  client: PoolClient,
  aggregateId: string,
  action: string,
  actorId: string | null,
  version: number,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await client.query('INSERT INTO audit (actor_id,action,aggregate_id,metadata) VALUES ($1,$2,$3,$4)', [
    actorId,
    action,
    aggregateId,
    JSON.stringify({ version }),
  ]);
  await client.query(
    'INSERT INTO outbox (topic,aggregate_id,payload,dedupe_key) VALUES ($1,$2,$3,$4) ON CONFLICT (dedupe_key) DO NOTHING',
    [action, aggregateId, JSON.stringify(payload), `${aggregateId}:${version}:${action}`],
  );
}
