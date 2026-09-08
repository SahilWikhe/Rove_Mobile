import { z } from 'zod';
import type { Pool } from 'pg';
import type { DriverPayoutProvider } from './driver-payout-provider';
import type { JobHandler } from './outbox';
import { transaction } from './transactions';
import { DomainError } from './errors';
const Payload = z
  .object({ source: z.string(), accountId: z.string().regex(/^acct_[a-zA-Z0-9]{1,96}$/) })
  .strict();
const State = z.enum(['ready', 'pending', 'needs_information']);
const validityMs = 60 * 60 * 1000;
export class PayoutReconciler {
  constructor(
    private pool: Pool,
    private provider: DriverPayoutProvider,
    private source: string,
    private now: () => Date = () => new Date(),
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid payout source.');
  }
  readonly handle: JobHandler = async (job) => {
    const parsed = Payload.safeParse(job.payload);
    if (!parsed.success || parsed.data.source !== this.source)
      throw new DomainError('PAYOUT_JOB_MISMATCH', 'Invalid payout reconciliation job.', 422);
    await this.reconcile(parsed.data.accountId);
  };
  async reconcile(accountId: string) {
    const started = this.now();
    const binding = (
      await this.pool.query<{ id: string; driver_id: string; sync_revision: number }>(
        `UPDATE driver_payout_accounts SET sync_revision=sync_revision+1 WHERE account_id=$1 AND source=$2 RETURNING id,driver_id,sync_revision`,
        [accountId, this.source],
      )
    ).rows[0];
    // Non-Rove accounts are not looked up. Initial provisioning enqueues its own job after binding.
    if (!binding) return;
    let status: 'ready' | 'pending' | 'needs_information' | 'unavailable';
    let failed = false;
    try {
      status = State.parse(
        await this.provider.status({ driverId: binding.driver_id, bindingId: binding.id, accountId }),
      );
    } catch {
      status = 'unavailable';
      failed = true;
    }
    await transaction(this.pool, async (client) => {
      await client.query('SELECT id FROM drivers WHERE id=$1 FOR UPDATE', [binding.driver_id]);
      const saved = await client.query(
        `UPDATE driver_payout_accounts SET status=$2,checked_at=$3
        WHERE id=$1 AND sync_revision=$4 AND account_id=$5 AND source=$6 RETURNING id`,
        [binding.id, status, this.now(), binding.sync_revision, accountId, this.source],
      );
      if (!saved.rowCount) return; // A newer request superseded this response, including its failure.
      const validUntil = new Date(started.getTime() + validityMs);
      const ready = status === 'ready' && validUntil > this.now();
      await client.query(
        `UPDATE drivers SET payout_ready=$2 AND NOT u.disabled AND u.role='driver',
        payout_valid_until=CASE WHEN $2 AND NOT u.disabled AND u.role='driver' THEN $3::timestamptz ELSE NULL END
        FROM users u WHERE drivers.id=$1 AND u.id=drivers.id`,
        [binding.driver_id, ready, validUntil],
      );
      await client.query('INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES(NULL,$1,$2,$3)', [
        'payout.status_checked',
        binding.driver_id,
        JSON.stringify({ status, source: this.source, revision: binding.sync_revision }),
      ]);
    });
    if (failed)
      throw new DomainError('PAYOUT_PROVIDER_UNAVAILABLE', 'Payout status could not be verified.', 503);
  }
  /** Bounded recovery for missed notifications; deduplicated independently of webhook delivery. */
  async sweep() {
    return transaction(this.pool, async (client) => {
      const rows = (
        await client.query<{ id: string; account_id: string }>(
          `SELECT id,account_id FROM driver_payout_accounts
        WHERE source=$1 AND account_id IS NOT NULL AND (last_requested_at IS NULL OR last_requested_at <= $2::timestamptz-interval '30 minutes')
        ORDER BY last_requested_at NULLS FIRST,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
          [this.source, this.now()],
        )
      ).rows;
      for (const row of rows) {
        await client.query(
          `INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES('payout.reconcile',$1,$2,$3) ON CONFLICT(dedupe_key) DO NOTHING`,
          [
            row.id,
            JSON.stringify({ source: this.source, accountId: row.account_id }),
            `payout-refresh:${row.id}:${Math.floor(this.now().getTime() / 1800000)}`,
          ],
        );
        await client.query('UPDATE driver_payout_accounts SET last_requested_at=$2 WHERE id=$1', [
          row.id,
          this.now(),
        ]);
      }
      return rows.length;
    });
  }
}
