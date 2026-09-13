import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { DisplayName } from '@rove/contracts';
import { transaction } from './transactions';
import { DomainError } from './errors';
import type { Actor } from './rides';

/** Backend-only: subject must come from the configured token verifier, never request JSON. */
async function bindVerifiedSubject(client: PoolClient, subject: string) {
  z.string().min(1).max(2048).parse(subject);
  await client.query(
    "SELECT set_config('rove.identity_subject',$1,true),set_config('rove.identity_signup','',true),set_config('rove.user_read','',true),set_config('rove.user_audience','',true),set_config('rove.user_profile_write','',true),set_config('rove.driver_write','',true),set_config('rove.ride_read','',true),set_config('rove.ride_write','',true),set_config('rove.ride_batch','',true),set_config('rove.ride_expiry_before','',true),set_config('rove.ride_create','',true),set_config('rove.user_close_write','',true),set_config('rove.closure_lookup_request','',true)",
    [subject],
  );
}

export async function findVerifiedProfile(pool: Pool, subject: string) {
  return transaction(pool, async (client) => {
    await bindVerifiedSubject(client, subject);
    return (
      await client.query<{ id: string; name: string; role: Actor['role']; disabled: boolean }>(
        'SELECT id,name,role,disabled FROM users WHERE subject=$1',
        [subject],
      )
    ).rows[0];
  });
}

export async function registerVerifiedProfile(pool: Pool, subject: string, raw: unknown) {
  const input = z
    .object({ name: DisplayName, role: z.enum(['rider', 'driver']) })
    .strict()
    .parse(raw);
  return transaction(pool, async (client) => {
    await bindVerifiedSubject(client, subject);
    await client.query("SELECT set_config('rove.identity_signup',$1,true)", [JSON.stringify(input)]);
    type Registered = { id: string; name: string; role: Actor['role']; disabled: boolean };
    await client.query(
      'INSERT INTO users (subject,name,role) VALUES ($1,$2,$3) ON CONFLICT (subject) DO NOTHING',
      [subject, input.name, input.role],
    );
    // A separate statement sees the winning concurrent signup; no UPDATE privilege is needed for a retry.
    const saved = (
      await client.query<Registered>('SELECT id,name,role,disabled FROM users WHERE subject=$1 FOR SHARE', [
        subject,
      ])
    ).rows[0];
    if (!saved || saved.disabled) throw new DomainError('ACCOUNT_DISABLED', 'Account is unavailable.', 403);
    const user = { id: saved.id, name: saved.name, role: saved.role };
    if (user.role === 'driver')
      await client.query('INSERT INTO drivers (id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
    return user;
  });
}
