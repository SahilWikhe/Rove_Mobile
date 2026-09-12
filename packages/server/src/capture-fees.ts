import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { CaptureBalanceProvider } from './capture-balance-provider';
import type { PaymentReference } from './payment-provider';
import { DomainError } from './errors';
import type { JobHandler } from './outbox';
import { transaction } from './transactions';

const Amount = z.number().int().min(0).max(99_999_999);
const Snapshot = z
  .object({
    chargeId: z.string().regex(/^ch_[a-zA-Z0-9]{1,96}$/),
    balanceId: z.string().regex(/^txn_[a-zA-Z0-9]{1,96}$/),
    amountCents: Amount.min(1),
    feeCents: Amount,
    netCents: Amount,
    status: z.enum(['pending', 'available']),
    disputed: z.boolean(),
    unrefundedCents: Amount,
  })
  .strict()
  .refine(
    (s) =>
      s.feeCents <= s.amountCents &&
      s.netCents === s.amountCents - s.feeCents &&
      s.unrefundedCents <= s.amountCents,
  );
const review = () =>
  new DomainError('CAPTURE_ACCOUNTING_REVIEW', 'Capture accounting requires verification.', 409);
const retry = () => new DomainError('CAPTURE_ACCOUNTING_RETRY', 'Capture verification changed. Retry.', 503);

/** Observes original processor fees without changing earned amounts or authorizing money movement. */
export class CaptureFees {
  constructor(
    private pool: Pool,
    private provider: CaptureBalanceProvider,
    private source: string,
    private now: () => Date = () => new Date(),
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid capture source.');
  }
  readonly handle: JobHandler = async (job) => {
    const p = z
      .object({ source: z.literal(this.source), intentId: z.string().regex(/^pi_[a-zA-Z0-9]{1,96}$/) })
      .strict()
      .safeParse(job.payload);
    if (!p.success) throw review();
    await this.reconcile(p.data.intentId);
  };
  private async context(c: PoolClient, intentId: string) {
    const row = (
      await c.query(
        `SELECT p.id,p.ride_id,p.amount_cents,c.customer_id FROM payment_attempts p
      JOIN payment_customers c ON c.id=p.customer_binding_id AND c.source=p.source
      JOIN rides r ON r.id=p.ride_id AND r.rider_id=c.rider_id AND r.fare_cents=p.amount_cents
      WHERE p.source=$1 AND p.intent_id=$2 FOR UPDATE OF p`,
        [this.source, intentId],
      )
    ).rows[0];
    if (!row) throw review();
    const ref: PaymentReference = {
      attemptId: row.id,
      rideId: row.ride_id,
      amountCents: row.amount_cents,
      customerId: row.customer_id,
      intentId,
    };
    return ref;
  }
  private async capture(c: PoolClient, ref: PaymentReference) {
    const rows = (
      await c.query(
        `SELECT j.id,j.key,p.account,p.owner_id,p.amount_cents FROM ledger_journals j
      JOIN ledger_postings p ON p.journal_id=j.id WHERE j.attempt_id=$1 AND j.ride_id=$2 AND j.kind='capture'`,
        [ref.attemptId, ref.rideId],
      )
    ).rows;
    if (
      rows.length !== 2 ||
      rows.some((r) => r.key !== `${ref.attemptId}:capture`) ||
      !rows.some(
        (r) => r.account === 'stripe_clearing' && r.owner_id === null && r.amount_cents === ref.amountCents,
      ) ||
      !rows.some(
        (r) => r.account === 'rider_funds' && r.owner_id !== null && r.amount_cents === -ref.amountCents,
      )
    )
      throw review();
    const owner = (await c.query('SELECT rider_id FROM rides WHERE id=$1', [ref.rideId])).rows[0]?.rider_id;
    if (!rows.some((r) => r.account === 'rider_funds' && r.owner_id === owner)) throw review();
  }
  async reconcile(intentId: string) {
    const before = await transaction(this.pool, async (c) => {
      const ref = await this.context(c, intentId);
      await this.capture(c, ref);
      await c.query(
        'INSERT INTO payment_capture_checks(attempt_id,source) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [ref.attemptId, this.source],
      );
      const row = (
        await c.query(
          'UPDATE payment_capture_checks SET revision=revision+1 WHERE attempt_id=$1 AND source=$2 RETURNING revision',
          [ref.attemptId, this.source],
        )
      ).rows[0];
      if (!row) throw review();
      return { ref, revision: row.revision };
    });
    const result = Snapshot.safeParse(await this.provider.retrieve(before.ref));
    if (!result.success || result.data.amountCents !== before.ref.amountCents) throw review();
    const b = result.data;
    const outcome = await transaction(this.pool, async (c) => {
      const ref = await this.context(c, intentId);
      if (JSON.stringify(ref) !== JSON.stringify(before.ref)) throw review();
      await this.capture(c, ref);
      const stored = (
        await c.query('SELECT * FROM payment_capture_checks WHERE attempt_id=$1 FOR UPDATE', [ref.attemptId])
      ).rows[0];
      if (stored.revision !== before.revision) throw retry();
      const conflict =
        stored.balance_id &&
        (stored.balance_id !== b.balanceId ||
          stored.charge_id !== b.chargeId ||
          stored.amount_cents !== b.amountCents ||
          stored.fee_cents !== b.feeCents ||
          stored.net_cents !== b.netCents ||
          b.status !== 'available');
      if (conflict || stored.review_required) {
        await c.query(
          'UPDATE payment_capture_checks SET review_required=true,checked_at=$2 WHERE attempt_id=$1',
          [ref.attemptId, this.now()],
        );
        if (!stored.review_required)
          await this.audit(c, ref, 'capture.fee_review_required', { balanceChanged: true });
        return false;
      }
      if (b.status === 'pending') {
        await c.query('UPDATE payment_capture_checks SET checked_at=$2 WHERE attempt_id=$1', [
          ref.attemptId,
          this.now(),
        ]);
        return false;
      }
      const key = `capture-fee:${this.source}:${b.balanceId}`;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      const reused = (
        await c.query('SELECT attempt_id FROM payment_capture_checks WHERE source=$1 AND balance_id=$2', [
          this.source,
          b.balanceId,
        ])
      ).rows[0];
      if (reused && reused.attempt_id !== ref.attemptId) throw review();
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            source: this.source,
            ref,
            chargeId: b.chargeId,
            balanceId: b.balanceId,
            amount: b.amountCents,
            fee: b.feeCents,
            net: b.netCents,
          }),
        )
        .digest('hex');
      let journalId = stored.journal_id;
      if (b.feeCents > 0) {
        const prior = (await c.query('SELECT * FROM ledger_journals WHERE key=$1', [key])).rows[0];
        if (prior) {
          if (prior.fingerprint !== fingerprint || prior.id !== stored.journal_id) throw review();
        } else {
          if (stored.balance_id) throw review();
          journalId = (
            await c.query(
              `INSERT INTO ledger_journals(key,fingerprint,attempt_id,ride_id,kind) VALUES($1,$2,$3,$4,'capture_fee') RETURNING id`,
              [key, fingerprint, ref.attemptId, ref.rideId],
            )
          ).rows[0].id;
          await c.query(
            `INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents) VALUES($1,'processor_fees',NULL,$2),($1,'stripe_clearing',NULL,-$2)`,
            [journalId, b.feeCents],
          );
        }
      }
      await c.query(
        `UPDATE payment_capture_checks SET charge_id=$2,balance_id=$3,amount_cents=$4,fee_cents=$5,net_cents=$6,journal_id=$7,verified_at=$8,checked_at=$8 WHERE attempt_id=$1`,
        [
          ref.attemptId,
          b.chargeId,
          b.balanceId,
          b.amountCents,
          b.feeCents,
          b.netCents,
          journalId,
          this.now(),
        ],
      );
      if (!stored.balance_id)
        await this.audit(c, ref, 'capture.fee_verified', {
          amountCents: b.amountCents,
          feeCents: b.feeCents,
          netCents: b.netCents,
        });
      return true;
    });
    if (!outcome) throw review();
  }
  private async audit(c: PoolClient, ref: PaymentReference, action: string, detail: object) {
    await c.query('INSERT INTO audit(aggregate_id,action,metadata) VALUES($1,$2,$3)', [
      ref.rideId,
      action,
      JSON.stringify(detail),
    ]);
  }
  async assertReady(c: PoolClient, attemptId: string, amountCents: number) {
    const row = (
      await c.query('SELECT * FROM payment_capture_checks WHERE attempt_id=$1 AND source=$2 FOR SHARE', [
        attemptId,
        this.source,
      ])
    ).rows[0];
    if (
      !row ||
      row.review_required ||
      !row.verified_at ||
      row.amount_cents !== amountCents ||
      row.verified_at < new Date(this.now().getTime() - 300000) ||
      row.verified_at > new Date(this.now().getTime() + 10000)
    )
      throw review();
    return { chargeId: row.charge_id as string };
  }
  async sweep() {
    return transaction(this.pool, async (c) => {
      const rows = (
        await c.query(
          `SELECT p.id,p.intent_id FROM payment_attempts p WHERE p.source=$1 AND p.intent_id IS NOT NULL
        AND EXISTS(SELECT 1 FROM ledger_journals j WHERE j.attempt_id=p.id AND j.kind='capture')
        AND NOT EXISTS(SELECT 1 FROM payment_capture_checks f WHERE f.attempt_id=p.id AND (f.review_required OR f.requested_at>=$2::timestamptz-interval '1 hour'))
        ORDER BY (SELECT f.requested_at FROM payment_capture_checks f WHERE f.attempt_id=p.id) NULLS FIRST,p.id LIMIT 100 FOR UPDATE OF p SKIP LOCKED`,
          [this.source, this.now()],
        )
      ).rows;
      for (const r of rows) {
        await c.query(
          'INSERT INTO payment_capture_checks(attempt_id,source,requested_at) VALUES($1,$2,$3) ON CONFLICT(attempt_id) DO UPDATE SET requested_at=EXCLUDED.requested_at',
          [r.id, this.source, this.now()],
        );
        await c.query(
          `INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES('capture-fee.reconcile',$1,$2,$3)`,
          [
            r.id,
            JSON.stringify({ source: this.source, intentId: r.intent_id }),
            `capture-fee-sweep:${r.id}:${randomUUID()}`,
          ],
        );
      }
      return rows.length;
    });
  }
}
