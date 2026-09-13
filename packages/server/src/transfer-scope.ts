import type { PoolClient } from 'pg';
import { z } from 'zod';
/** Internal transaction scopes; execution writes target one durable transfer authorization. */
export async function bindTransferScope(
  client: PoolClient,
  source: string,
  scope: { attemptId?: string; operationId?: string; writable?: boolean; sweep?: boolean },
) {
  z.string()
    .regex(/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/)
    .parse(source);
  if (scope.attemptId) z.uuid().parse(scope.attemptId);
  if (scope.operationId) z.uuid().parse(scope.operationId);
  if ((!scope.sweep && !scope.attemptId && !scope.operationId) || (scope.writable && !scope.operationId))
    throw new Error('Exact transfer scope required.');
  await client.query(
    "SELECT set_config('rove.transfer_source',$1,true),set_config('rove.transfer_attempt',$2,true),set_config('rove.transfer_read',$3,true),set_config('rove.transfer_write',$4,true),set_config('rove.transfer_sweep',$5,true),set_config('rove.transfer_balance','',true),set_config('rove.transfer_closure_owner','',true)",
    [
      source,
      scope.attemptId ?? '',
      scope.operationId ?? '',
      scope.writable ? scope.operationId! : '',
      scope.sweep ? 'true' : 'false',
    ],
  );
}
