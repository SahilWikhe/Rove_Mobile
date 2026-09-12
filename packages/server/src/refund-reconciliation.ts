import { z } from 'zod';
import type { Pool } from 'pg';
import type { RefundProvider, PaymentReference } from './payment-provider';
import type { JobHandler } from './outbox';
import { DomainError } from './errors';
import { transaction } from './transactions';
const Refund = z
  .object({
    id: z.string().regex(/^re_[a-zA-Z0-9]{1,96}$/),
    intentId: z.string().regex(/^pi_[a-zA-Z0-9]{1,96}$/),
    amountCents: z.number().int().min(1).max(99_999_999),
    status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
    created: z.number().int().min(0).max(2_147_483_647),
  })
  .strict();
const Refunds = z.array(Refund).max(1000);
const mismatch = () =>
  new DomainError('PAYMENT_REFUND_MISMATCH', 'Refund history could not be verified.', 503);
const retry = () =>
  new DomainError('PAYMENT_REFUND_RETRY', 'Refund history changed during verification. Retry.', 503);
/** Provider reads run outside transactions; observations never authorize a refund or debit a driver. */
export class RefundReconciler {
  constructor(
    private pool: Pool,
    private provider: RefundProvider,
    private source: string,
    private now: () => Date = () => new Date(),
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid refund source.');
  }
  readonly handle: JobHandler = async (job) => {
    const parsed = z
      .object({ source: z.literal(this.source), intentId: z.string().regex(/^pi_[a-zA-Z0-9]{1,96}$/) })
      .strict()
      .safeParse(job.payload);
    if (!parsed.success) throw mismatch();
    await this.reconcile(parsed.data.intentId);
  };
  async reconcile(intentId: string) {
    const row = (
      await this.pool.query<{
        id: string;
        ride_id: string;
        customer_binding_id: string;
        rider_id: string;
        customer_id: string;
        amount_cents: number;
      }>(
        `SELECT p.*,c.rider_id,c.customer_id FROM payment_attempts p
       JOIN payment_customers c ON c.id=p.customer_binding_id AND c.source=p.source
       JOIN rides r ON r.id=p.ride_id AND r.rider_id=c.rider_id AND r.fare_cents=p.amount_cents
       WHERE p.source=$1 AND p.intent_id=$2`,
        [this.source, intentId],
      )
    ).rows[0];
    if (!row)
      throw new DomainError('PAYMENT_REFERENCE_PENDING', 'Payment reference is not available yet.', 503);
    await this.pool.query(
      'INSERT INTO payment_refund_checks(attempt_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [row.id],
    );
    const before = (
      await this.pool.query<{
        revision: number;
        refunds: unknown;
        received_cents: number;
        verified_at: Date | null;
      }>('SELECT * FROM payment_refund_checks WHERE attempt_id=$1', [row.id])
    ).rows[0]!;
    const reference: PaymentReference = {
      intentId,
      attemptId: row.id,
      rideId: row.ride_id,
      customerId: row.customer_id,
      amountCents: row.amount_cents,
    };
    const result = await this.provider.refunds(reference);
    const current = Refunds.safeParse(result.refunds);
    const payment = result.payment;
    if (
      !current.success ||
      Object.entries(reference).some(([key, value]) => payment[key as keyof PaymentReference] !== value) ||
      ![
        'requires_payment_method',
        'requires_confirmation',
        'requires_action',
        'processing',
        'requires_capture',
        'canceled',
        'succeeded',
      ].includes(payment.status) ||
      !Number.isSafeInteger(payment.capturableCents) ||
      payment.capturableCents < 0 ||
      payment.capturableCents > row.amount_cents ||
      !Number.isSafeInteger(payment.receivedCents) ||
      payment.receivedCents < 0 ||
      payment.receivedCents > row.amount_cents
    )
      throw mismatch();
    const refunds = current.data.sort((a, b) => a.id.localeCompare(b.id));
    const seen = new Set<string>();
    let committed = 0;
    for (const refund of refunds) {
      if (
        refund.intentId !== intentId ||
        seen.has(refund.id) ||
        refund.amountCents > payment.receivedCents ||
        payment.status !== 'succeeded'
      )
        throw mismatch();
      seen.add(refund.id);
      if (['succeeded', 'pending', 'requires_action'].includes(refund.status))
        committed += refund.amountCents;
    }
    if (committed > payment.receivedCents) throw mismatch();
    const previous = Refunds.parse(before.refunds);
    for (const old of previous) {
      const next = refunds.find((item) => item.id === old.id);
      if (
        !next ||
        next.amountCents !== old.amountCents ||
        next.created !== old.created ||
        next.intentId !== old.intentId
      )
        throw mismatch();
    }
    const changed =
      JSON.stringify(previous) !== JSON.stringify(refunds) ||
      before.received_cents !== payment.receivedCents ||
      !before.verified_at;
    const verifiedAt = this.now();
    await transaction(this.pool, async (client) => {
      const valid = await client.query(
        `SELECT p.id FROM payment_attempts p JOIN payment_customers c ON c.id=p.customer_binding_id
       JOIN rides r ON r.id=p.ride_id WHERE p.id=$1 AND p.source=$2 AND p.intent_id=$3 AND p.customer_binding_id=$4
       AND c.source=p.source AND c.customer_id=$5 AND c.rider_id=r.rider_id AND r.fare_cents=p.amount_cents AND p.amount_cents=$6 FOR UPDATE OF p,r`,
        [row.id, this.source, intentId, row.customer_binding_id, row.customer_id, row.amount_cents],
      );
      if (valid.rowCount !== 1) throw mismatch();
      const updated = await client.query(
        `UPDATE payment_refund_checks SET revision=revision+1,refunds=$3,received_cents=$4,verified_at=$5 WHERE attempt_id=$1 AND revision=$2`,
        [row.id, before.revision, JSON.stringify(refunds), payment.receivedCents, verifiedAt],
      );
      if (updated.rowCount !== 1) throw retry();
      if (changed)
        await client.query(
          `INSERT INTO payment_refund_observations(attempt_id,revision,refunds,received_cents,verified_at) VALUES ($1,$2,$3,$4,$5)`,
          [row.id, before.revision + 1, JSON.stringify(refunds), payment.receivedCents, verifiedAt],
        );
    });
  }
  async sweep() {
    return transaction(this.pool, async (client) => {
      const candidates = await client.query<{ id: string; intent_id: string }>(
        `SELECT p.id,p.intent_id FROM payment_attempts p
       JOIN rides r ON r.id=p.ride_id LEFT JOIN payment_refund_checks c ON c.attempt_id=p.id
       WHERE p.source=$1 AND p.intent_id IS NOT NULL AND r.payment_state IN ('paid','review_required')
       AND (c.verified_at IS NULL OR c.verified_at<$2) AND (c.requested_at IS NULL OR c.requested_at<$3) ORDER BY c.requested_at NULLS FIRST,p.id LIMIT 100`,
        [this.source, new Date(this.now().getTime() - 3600000), new Date(this.now().getTime() - 600000)],
      );
      let inserted = 0;
      for (const row of candidates.rows) {
        await client.query(
          'INSERT INTO payment_refund_checks(attempt_id,requested_at) VALUES ($1,$2) ON CONFLICT(attempt_id) DO UPDATE SET requested_at=EXCLUDED.requested_at',
          [row.id, this.now()],
        );
        const result = await client.query(
          `INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES ('refund.reconcile',$1,$2,$3) ON CONFLICT DO NOTHING`,
          [
            row.id,
            JSON.stringify({ source: this.source, intentId: row.intent_id }),
            `refund-recovery:${row.id}:${Math.floor(this.now().getTime() / 3600000)}`,
          ],
        );
        inserted += result.rowCount ?? 0;
      }
      return inserted;
    });
  }
}
