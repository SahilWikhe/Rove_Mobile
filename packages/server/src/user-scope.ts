import type { PoolClient } from 'pg';
import { z } from 'zod';

/** Exact internal account lookup, including disabled status for authorization checks. */
export async function bindUserRead(client: PoolClient, userId: string) {
  z.uuid().parse(userId);
  await client.query(
    "SELECT set_config('rove.user_read',$1,true),set_config('rove.user_audience','',true),set_config('rove.user_profile_write','',true),set_config('rove.driver_write','',true),set_config('rove.user_close_write','',true),set_config('rove.closure_lookup_request','',true),set_config('rove.identity_subject','',true),set_config('rove.identity_signup','',true)",
    [userId],
  );
}

/** At most the persisted rider/driver pair of one notification, never queued recipient input. */
export async function bindUserAudience(client: PoolClient, userIds: string[]) {
  const selected = z.array(z.uuid()).max(2).parse(userIds);
  await client.query(
    "SELECT set_config('rove.user_audience',$1,true),set_config('rove.user_read','',true),set_config('rove.user_profile_write','',true),set_config('rove.driver_write','',true),set_config('rove.user_close_write','',true),set_config('rove.closure_lookup_request','',true),set_config('rove.identity_subject','',true),set_config('rove.identity_signup','',true)",
    [JSON.stringify([...new Set(selected)])],
  );
}
