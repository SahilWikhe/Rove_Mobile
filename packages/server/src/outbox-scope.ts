import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { transaction } from './transactions';

type Scope =
  | { kind: 'queue' }
  | { kind: 'claim'; token: string; at: Date }
  | { kind: 'ack'; id: string; token: string }
  | { kind: 'notification'; id: string };
/** Backend worker access only; every operation gets a short independent transaction. */
export async function outboxTransaction<T>(
  pool: Pool,
  scope: Scope,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if ('id' in scope) z.uuid().parse(scope.id);
  if ('token' in scope) z.uuid().parse(scope.token);
  return transaction(pool, async (client) => {
    await client.query("SELECT set_config('rove.outbox_work',$1,true)", [JSON.stringify(scope)]);
    return work(client);
  });
}
