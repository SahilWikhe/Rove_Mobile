import { bindUserRead } from './user-scope';
import { enqueueOutbox } from './outbox-enqueue';
import { actorTransaction, bindActorIdentity } from './actor-transaction';
import { bindPayoutScope } from './payout-scope';
import type { Pool, PoolClient } from 'pg';
import { DriverPayoutLink, type DriverPayoutStatus } from '@rove/contracts';
import type { Actor } from './rides';
import type { DriverPayoutProvider } from './driver-payout-provider';
import { DomainError } from './errors';
import { transaction } from './transactions';
type Binding = { id: string; account_id: string | null; created_at: Date };
const unavailable = () =>
  new DomainError('PAYOUT_SETUP_UNAVAILABLE', 'Payout setup is not available yet.', 503);
export class DriverPayouts {
  constructor(
    private pool: Pool,
    private source: string,
    private provider?: DriverPayoutProvider,
    private now: () => Date = () => new Date(),
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid payout source.');
  }
  private async authorize(client: PoolClient, actor: Actor, lock = false) {
    if (actor.role !== 'driver') throw new DomainError('FORBIDDEN', 'Payout setup is for drivers.', 403);
    await bindUserRead(client, actor.id);
    const row = (
      await client.query(
        `SELECT u.disabled FROM users u JOIN drivers d ON d.id=u.id
      WHERE u.id=$1 AND u.role='driver' ${lock ? 'FOR UPDATE OF u' : ''}`,
        [actor.id],
      )
    ).rows[0];
    if (!row || row.disabled) throw new DomainError('FORBIDDEN', 'Payout setup is unavailable.', 403);
  }
  async status(actor: Actor): Promise<DriverPayoutStatus> {
    await transaction(this.pool, (client) => this.authorize(client, actor));
    if (!this.provider) return { status: 'unavailable' };
    const binding = await actorTransaction(this.pool, actor, async (client) => {
      await bindPayoutScope(client, this.source, {});
      return (
        await client.query<Binding>('SELECT * FROM driver_payout_accounts WHERE driver_id=$1 AND source=$2', [
          actor.id,
          this.source,
        ])
      ).rows[0];
    });
    if (!binding) return { status: 'not_started' };
    if (!binding.account_id) return { status: 'pending' };
    const status = await this.provider.status({
      driverId: actor.id,
      bindingId: binding.id,
      accountId: binding.account_id,
    });
    await transaction(this.pool, (client) => this.authorize(client, actor));
    return { status };
  }
  async start(actor: Actor): Promise<DriverPayoutLink> {
    await transaction(this.pool, (client) => this.authorize(client, actor));
    if (!this.provider) throw unavailable();
    const binding = await transaction(this.pool, async (client) => {
      await bindActorIdentity(client, actor, 'update');
      await this.authorize(client, actor, true);
      await bindPayoutScope(client, this.source, {});
      const inserted = (
        await client.query<Binding>(
          `INSERT INTO driver_payout_accounts(driver_id,source,created_at) VALUES($1,$2,$3)
        ON CONFLICT(driver_id,source) DO NOTHING RETURNING *`,
          [actor.id, this.source, this.now()],
        )
      ).rows[0];
      const row =
        inserted ??
        (
          await client.query<Binding>(
            'SELECT * FROM driver_payout_accounts WHERE driver_id=$1 AND source=$2',
            [actor.id, this.source],
          )
        ).rows[0];
      if (!row) throw unavailable();
      if (!row.account_id && this.now().getTime() - row.created_at.getTime() >= 23 * 60 * 60 * 1000)
        throw new DomainError('PAYOUT_SETUP_REVIEW', 'An earlier payout setup needs support review.', 409);
      return row;
    });
    let accountId = binding.account_id;
    if (!accountId) {
      accountId = await this.provider.createAccount(
        { driverId: actor.id, bindingId: binding.id },
        `rove:${binding.id}:payout-account`,
      );
      if (!/^acct_[a-zA-Z0-9]{1,96}$/.test(accountId)) throw unavailable();
      // Save recovery mapping before checking disablement again. Never create a second account after an uncertain result.
      await transaction(this.pool, async (client) => {
        await bindPayoutScope(client, this.source, { bindingId: binding.id, result: accountId! });
        const result = await client.query(
          'UPDATE driver_payout_accounts SET account_id=$2 WHERE id=$1 AND (account_id IS NULL OR account_id=$2)',
          [binding.id, accountId],
        );
        if (result.rowCount !== 1) throw unavailable();
        await enqueueOutbox(client, {
          topic: 'payout.reconcile',
          aggregateId: binding.id,
          payload: JSON.stringify({ source: this.source, accountId }),
          dedupeKey: `payout-initial:${binding.id}`,
          ignoreDuplicate: true,
        });
      });
    }
    await transaction(this.pool, (client) => this.authorize(client, actor));
    // Verify mode/metadata of an existing mapping before minting a sensitive one-use URL.
    await this.provider.status({ driverId: actor.id, bindingId: binding.id, accountId });
    const link = DriverPayoutLink.parse(await this.provider.onboardingLink(accountId));
    const remaining = Date.parse(link.expiresAt) - this.now().getTime();
    if (remaining <= 0 || remaining > 30 * 60 * 1000) throw unavailable();
    await transaction(this.pool, (client) => this.authorize(client, actor));
    return link;
  }
}
