import type { PoolClient } from 'pg';
import { z } from 'zod';
/** Internal scope from a server-issued token hash; never accepts a client-selected driver. */
export async function bindTrackingScope(
  c: PoolClient,
  mode: 'issue' | 'read' | 'sample' | 'revoke',
  hash: string,
  driverId?: string,
) {
  z.enum(['issue', 'read', 'sample', 'revoke']).parse(mode);
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(hash);
  if (driverId) z.uuid().parse(driverId);
  if (mode === 'sample' && !driverId) throw new Error('Exact tracking driver required.');
  await c.query(
    "SELECT set_config('rove.tracking_mode',$1,true),set_config('rove.tracking_hash',$2,true),set_config('rove.tracking_driver',$3,true),set_config('rove.tracking_close_owner','',true)",
    [mode, hash, driverId ?? ''],
  );
}
export async function bindTrackingClosure(c: PoolClient, ownerId: string) {
  z.uuid().parse(ownerId);
  await c.query(
    "SELECT set_config('rove.tracking_mode','',true),set_config('rove.tracking_hash','',true),set_config('rove.tracking_driver','',true),set_config('rove.tracking_close_owner',$1,true)",
    [ownerId],
  );
}
