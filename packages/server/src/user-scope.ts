import type { PoolClient } from 'pg';
import { z } from 'zod';

/** Exact internal account lookup, including disabled status for authorization checks. */
export async function bindUserRead(client: PoolClient, userId: string) {
  z.uuid().parse(userId);
  await client.query(
    "SELECT set_config('rove.user_read',$1,true),set_config('rove.user_profile_write','',true),set_config('rove.user_close_write','',true),set_config('rove.identity_subject','',true),set_config('rove.identity_signup','',true)",
    [userId],
  );
}
