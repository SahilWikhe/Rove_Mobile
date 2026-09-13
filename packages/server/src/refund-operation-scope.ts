import { bindPaymentAttemptRead, bindPaymentAttemptScan } from './payment-attempt-scope';
import type { PoolClient } from 'pg';
import { z } from 'zod';
/** Trusted backend transaction scope; writes target only an already-authorized operation. */
export async function bindRefundOperationScope(
  client: PoolClient,
  source: string,
  scope: { attemptId?: string; operationId?: string; writable?: boolean },
) {
  z.string()
    .regex(/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/)
    .parse(source);
  if (scope.attemptId) z.uuid().parse(scope.attemptId);
  if (scope.operationId) z.uuid().parse(scope.operationId);
  if ((!scope.attemptId && !scope.operationId) || (scope.writable && !scope.operationId))
    throw new Error('Exact refund operation scope required.');
  if (scope.attemptId) await bindPaymentAttemptRead(client, source, { attemptId: scope.attemptId });
  else await bindPaymentAttemptScan(client, source);
  await client.query(
    "SELECT set_config('rove.refund_operation_source',$1,true),set_config('rove.refund_operation_attempt',$2,true),set_config('rove.refund_operation_read',$3,true),set_config('rove.refund_operation_write',$4,true),set_config('rove.refund_closure_owner','',true)",
    [source, scope.attemptId ?? '', scope.operationId ?? '', scope.writable ? scope.operationId! : ''],
  );
}
