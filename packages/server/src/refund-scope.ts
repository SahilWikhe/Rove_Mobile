import type { PoolClient } from 'pg';
import { z } from 'zod';
/** Internal transaction scope. Read mode allows evidence locks but never accounting changes. */
export async function bindRefundScope(
  client: PoolClient,
  source: string,
  mode: 'read' | 'write' | 'sweep',
  attemptId?: string,
) {
  z.string()
    .regex(/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/)
    .parse(source);
  if (mode !== 'sweep') z.uuid().parse(attemptId);
  await client.query(
    "SELECT set_config('rove.refund_source',$1,true),set_config('rove.refund_read',$2,true),set_config('rove.refund_write',$3,true),set_config('rove.refund_sweep',$4,true)",
    [
      source,
      mode === 'read' ? attemptId! : '',
      mode === 'write' ? attemptId! : '',
      mode === 'sweep' ? 'true' : 'false',
    ],
  );
}
