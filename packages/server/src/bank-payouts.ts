import type { Pool, PoolClient } from 'pg';
import { BankPayoutCursor, BankPayoutHistory } from '@rove/contracts';
import type { DriverPayoutReference } from './driver-payout-provider';
import type { Actor } from './rides';
import { DomainError } from './errors';
import { transaction } from './transactions';
export interface BankPayoutProvider {
  list(
    reference: DriverPayoutReference & { accountId: string },
    after?: string,
  ): Promise<Pick<BankPayoutHistory, 'items' | 'nextCursor'>>;
}
export class BankPayouts {
  constructor(
    private pool: Pool,
    private source: string,
    private provider?: BankPayoutProvider,
    private now: () => Date = () => new Date(),
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid bank payout source.');
  }
  private async binding(c: Pool | PoolClient, actor: Actor, lock = false) {
    if (actor.role !== 'driver') throw new DomainError('FORBIDDEN', 'Payout history is for drivers.', 403);
    const user = (
      await c.query(
        `SELECT u.disabled FROM users u JOIN drivers d ON d.id=u.id WHERE u.id=$1 AND u.role='driver' ${lock ? 'FOR SHARE OF u,d' : ''}`,
        [actor.id],
      )
    ).rows[0];
    if (!user || user.disabled) throw new DomainError('FORBIDDEN', 'Payout history is unavailable.', 403);
    return (
      await c.query(
        `SELECT id,account_id FROM driver_payout_accounts WHERE driver_id=$1 AND source=$2 ${lock ? 'FOR SHARE' : ''}`,
        [actor.id, this.source],
      )
    ).rows[0];
  }
  async list(actor: Actor, rawAfter?: string): Promise<BankPayoutHistory> {
    if (rawAfter !== undefined && !BankPayoutCursor.safeParse(rawAfter).success)
      throw new DomainError('INVALID_PAYOUT_CURSOR', 'Choose a valid payout history page.', 400);
    const after = rawAfter;
    const binding = await this.binding(this.pool, actor);
    if (!this.provider) return { status: 'unavailable', items: [], nextCursor: null, checkedAt: null };
    if (!binding?.account_id) return { status: 'not_started', items: [], nextCursor: null, checkedAt: null };
    const page = await this.provider.list(
      { driverId: actor.id, bindingId: binding.id, accountId: binding.account_id },
      after,
    );
    const parsed = BankPayoutHistory.safeParse({
      ...page,
      status: 'available',
      checkedAt: this.now().toISOString(),
    });
    if (!parsed.success)
      throw new DomainError(
        'BANK_PAYOUT_PROVIDER_UNAVAILABLE',
        'Bank payout history could not be verified. Try again.',
        503,
      );
    const result = parsed.data;
    return transaction(this.pool, async (c) => {
      const current = await this.binding(c, actor, true);
      if (current?.id !== binding.id || current?.account_id !== binding.account_id)
        throw new DomainError('PAYOUT_HISTORY_CHANGED', 'Payout account changed. Refresh to continue.', 409);
      return result;
    });
  }
}
