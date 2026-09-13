import { bindUserRead } from './user-scope';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DomainError } from './errors';
/** Backend-only retry scope; each result belongs to one active actor and one command key. */
export async function bindCommandScope(c: PoolClient, actorId: string, key: string, fingerprint?: string) {
  z.uuid().parse(actorId);
  z.string()
    .regex(/^[a-zA-Z0-9_-]{8,100}$/)
    .parse(key);
  if (fingerprint)
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(fingerprint);
  await bindUserRead(c, actorId);
  const user = (await c.query('SELECT id,disabled FROM users WHERE id=$1', [actorId])).rows[0];
  if (!user) throw new DomainError('NOT_FOUND', 'Account not found.', 404);
  if (user.disabled) throw new DomainError('ACCOUNT_DISABLED', 'This account is disabled.', 403);
  await c.query(
    "SELECT set_config('rove.command_actor',$1,true),set_config('rove.command_key',$2,true),set_config('rove.command_fingerprint',$3,true)",
    [actorId, key, fingerprint ?? ''],
  );
}
