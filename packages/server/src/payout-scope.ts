import type { PoolClient } from 'pg';
import { z } from 'zod';
/** Internal backend scopes. Provider result and reconciliation writes never authorize onboarding. */
export async function bindPayoutScope(
  client: PoolClient,
  source: string,
  scope: {
    driverId?: string;
    accountId?: string;
    bindingId?: string;
    result?: string;
    sweep?: boolean;
  },
) {
  z.string()
    .regex(/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/)
    .parse(source);
  if (scope.driverId) z.uuid().parse(scope.driverId);
  if (scope.bindingId) z.uuid().parse(scope.bindingId);
  for (const value of [scope.accountId, scope.result])
    if (value)
      z.string()
        .regex(/^acct_[a-zA-Z0-9]{1,96}$/)
        .parse(value);
  if (scope.result && !scope.bindingId) throw new Error('Exact payout result binding required.');
  await client.query(
    "SELECT set_config('rove.payout_source',$1,true),set_config('rove.payout_driver',$2,true),set_config('rove.payout_account',$3,true),set_config('rove.payout_binding',$4,true),set_config('rove.payout_result',$5,true),set_config('rove.payout_sweep',$6,true)",
    [
      source,
      scope.driverId ?? '',
      scope.accountId ?? '',
      scope.bindingId ?? '',
      scope.result ?? '',
      scope.sweep ? 'true' : 'false',
    ],
  );
}
