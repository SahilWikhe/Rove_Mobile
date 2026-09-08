import type { Pool } from 'pg';
import { z } from 'zod';
import type { PaymentProvider, PaymentReference, PaymentSnapshot } from './payment-provider';
import { recordCapturedFunds } from './ledger';
import { DomainError } from './errors';
import { transaction, event } from './transactions';
import type { JobHandler } from './outbox';

interface AttemptRow {
  id: string;
  ride_id: string;
  intent_id: string;
  source: string;
  amount_cents: number;
  revision: number;
  customer_id: string;
  rider_id: string;
  customer_source: string;
  customer_binding_id: string;
}
const JobPayload = z
  .object({ source: z.string(), intentId: z.string().regex(/^pi_[a-zA-Z0-9]{1,96}$/) })
  .strict();
const intentStates = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'requires_capture',
  'canceled',
  'succeeded',
]);
const problem = () => new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment could not be verified.', 503);
function validateSnapshot(value: PaymentSnapshot, reference: PaymentReference) {
  if (
    Object.entries(reference).some(([key, expected]) => value[key as keyof PaymentReference] !== expected) ||
    !intentStates.has(value.status) ||
    !Number.isSafeInteger(value.capturableCents) ||
    !Number.isSafeInteger(value.receivedCents) ||
    value.capturableCents < 0 ||
    value.receivedCents < 0 ||
    value.capturableCents > reference.amountCents ||
    value.receivedCents > reference.amountCents
  )
    throw problem();
}
/** Retrieves current provider truth; webhook event types never directly mutate funding. */
export class PaymentReconciler {
  constructor(
    private pool: Pool,
    private provider: PaymentProvider,
    private source: string,
    private now: () => Date = () => new Date(),
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid payment source.');
  }
  readonly handle: JobHandler = async (job) => {
    const parsed = JobPayload.safeParse(job.payload);
    if (!parsed.success || parsed.data.source !== this.source)
      throw new DomainError('PAYMENT_JOB_MISMATCH', 'Payment job is not configured for this provider.', 422);
    await this.reconcile(parsed.data.intentId);
  };
  readonly rideChanged: JobHandler = async (job) => {
    const row = (
      await this.pool.query<{ intent_id: string }>(
        'SELECT intent_id FROM payment_attempts WHERE ride_id=$1 AND source=$2',
        [job.aggregateId, this.source],
      )
    ).rows[0];
    if (!row?.intent_id)
      throw new DomainError('PAYMENT_REFERENCE_PENDING', 'Payment reference is not available yet.', 503);
    await this.reconcile(row.intent_id);
  };
  handlers(): Record<string, JobHandler> {
    return {
      'payment.reconcile': this.handle,
      'payment.capture': this.capture,
      'payment.release': this.release,
      'ride.completed': this.rideChanged,
      'ride.cancelled': this.rideChanged,
      'ride.no_driver_found': this.rideChanged,
      'ride.interrupted': this.rideChanged,
      'ride.terminated': this.rideChanged,
      'ride.no_show': this.rideChanged,
    };
  }
  readonly capture: JobHandler = async (job) => this.settle(job, 'capture');
  readonly release: JobHandler = async (job) => this.settle(job, 'release');
  private async settle(job: Parameters<JobHandler>[0], operation: 'capture' | 'release') {
    const parsed = z.object({ attemptId: z.uuid() }).strict().safeParse(job.payload);
    if (!parsed.success) throw new DomainError('PAYMENT_JOB_MISMATCH', 'Invalid payment operation.', 422);
    const row = (
      await this.pool.query<
        AttemptRow & {
          state: string;
          payment_state: string;
          fare_cents: number;
          owner_id: string;
          search_deadline: Date;
        }
      >(
        `SELECT p.*,c.customer_id,c.rider_id,c.source AS customer_source,r.state,r.payment_state,r.fare_cents,r.rider_id AS owner_id,r.search_deadline
       FROM payment_attempts p JOIN payment_customers c ON c.id=p.customer_binding_id JOIN rides r ON r.id=p.ride_id
       WHERE p.id=$1 AND p.source=$2 AND p.ride_id=$3`,
        [parsed.data.attemptId, this.source, job.aggregateId],
      )
    ).rows[0];
    if (
      !row?.intent_id ||
      row.rider_id !== row.owner_id ||
      row.source !== row.customer_source ||
      row.fare_cents !== row.amount_cents
    )
      throw problem();
    // Completion/cancellation are terminal consumer states. Never charge from a client-supplied amount.
    const eligible =
      operation === 'capture'
        ? row.state === 'completed' && ['capture_pending', 'paid'].includes(row.payment_state)
        : (['cancelled', 'no_driver_found'].includes(row.state) ||
            (row.state === 'searching' && row.search_deadline <= this.now())) &&
          ['release_pending', 'released'].includes(row.payment_state);
    if (!eligible)
      throw new DomainError('PAYMENT_OPERATION_NOT_ALLOWED', 'Payment operation requires review.', 409);
    const reference: PaymentReference = {
      intentId: row.intent_id,
      rideId: row.ride_id,
      attemptId: row.id,
      customerId: row.customer_id,
      amountCents: row.amount_cents,
    };
    // Same attempt/operation always uses the same provider key, including worker lease retries.
    const key = `rove:${row.id}:${operation}`;
    if (operation === 'capture') await this.provider.capture(reference, row.amount_cents, key);
    else await this.provider.cancel(reference, key);
    // A successful mutation response is not a local settlement commit. Fetch and reconcile again.
    await this.reconcile(row.intent_id);
  }
  async reconcile(intentId: string): Promise<void> {
    const before = (
      await this.pool.query<AttemptRow>(
        `SELECT p.*,c.customer_id,c.rider_id,c.source AS customer_source FROM payment_attempts p
       JOIN payment_customers c ON c.id=p.customer_binding_id WHERE p.source=$1 AND p.intent_id=$2`,
        [this.source, intentId],
      )
    ).rows[0];
    // Stripe may deliver before creation's local reference commits. Retry; never infer an owner from metadata.
    if (!before)
      throw new DomainError('PAYMENT_REFERENCE_PENDING', 'Payment reference is not available yet.', 503);
    if (before.customer_source !== this.source) throw problem();
    const reference: PaymentReference = {
      intentId: before.intent_id,
      rideId: before.ride_id,
      attemptId: before.id,
      customerId: before.customer_id,
      amountCents: before.amount_cents,
    };
    // No database transaction/row lock is held across the network request.
    const current = await this.provider.retrieve(reference);
    validateSnapshot(current, reference);
    await transaction(this.pool, async (client) => {
      const ride = (
        await client.query<{
          rider_id: string;
          driver_id: string | null;
          earnings_cents: number;
          fare_cents: number;
          state: string;
          payment_state: string;
          version: number;
          search_deadline: Date;
        }>('SELECT * FROM rides WHERE id=$1 FOR UPDATE', [before.ride_id])
      ).rows[0];
      if (!ride || ride.rider_id !== before.rider_id || ride.fare_cents !== before.amount_cents)
        throw problem();
      // An overlapping fetch must retry after any newer reconciliation, including a no-op one.
      const updated = await client.query(
        `UPDATE payment_attempts SET revision=revision+1,provider_status=$3,reconciled_at=$4
         WHERE id=$1 AND revision=$2 AND intent_id=$5 AND source=$6 AND amount_cents=$7 AND customer_binding_id=$8`,
        [
          before.id,
          before.revision,
          current.status,
          this.now(),
          before.intent_id,
          this.source,
          before.amount_cents,
          before.customer_binding_id,
        ],
      );
      if (updated.rowCount !== 1)
        throw new DomainError('PAYMENT_RECONCILE_RETRY', 'Payment changed during verification. Retry.', 503);
      // Settled payment cannot be regressed by a delayed or inconsistent provider response.
      if (
        ride.payment_state === 'paid' &&
        (current.status !== 'succeeded' || current.receivedCents !== before.amount_cents)
      )
        throw problem();
      if (ride.payment_state === 'released' && current.status !== 'canceled') throw problem();
      let next: string;
      let work: string | undefined;
      if (current.status === 'succeeded') {
        next = current.receivedCents === before.amount_cents ? 'paid' : 'review_required';
        const allocated =
          current.receivedCents > 0 &&
          (await recordCapturedFunds(client, {
            attemptId: before.id,
            rideId: before.ride_id,
            riderId: ride.rider_id,
            receivedCents: current.receivedCents,
            driverId: ride.driver_id,
            earningsCents: ride.earnings_cents,
            completed: ride.state === 'completed',
            fullFare: current.receivedCents === before.amount_cents,
          }));
        if (!allocated) work = 'payment.review_required';
      } else if (current.status === 'canceled') {
        next = 'released';
        if (!['cancelled', 'no_driver_found'].includes(ride.state)) work = 'payment.review_required';
      } else if (
        ['cancelled', 'no_driver_found'].includes(ride.state) ||
        (ride.state === 'searching' && ride.search_deadline <= this.now())
      ) {
        next = 'release_pending';
        work = 'payment.release';
      } else if (current.status === 'requires_capture' && current.capturableCents === before.amount_cents) {
        if (ride.state === 'completed') {
          next = 'capture_pending';
          work = 'payment.capture';
        } else if (['searching', 'matched', 'en_route', 'arrived', 'in_progress'].includes(ride.state)) {
          next = 'authorized';
          if (ride.state === 'searching') work = 'matching.tick';
        } else {
          next = 'review_required';
          work = 'payment.review_required';
        }
      } else {
        next = current.status === 'requires_action' ? 'action_required' : 'pending';
        if (ride.state !== 'searching') {
          next = 'review_required';
          work = 'payment.review_required';
        }
      }
      if (next === ride.payment_state) return;
      if (next !== 'authorized')
        await client.query("UPDATE offers SET status='revoked' WHERE ride_id=$1 AND status='pending'", [
          before.ride_id,
        ]);
      await client.query('UPDATE rides SET payment_state=$2,version=version+1,updated_at=$3 WHERE id=$1', [
        before.ride_id,
        next,
        this.now(),
      ]);
      await event(client, before.ride_id, 'payment.updated', null, ride.version + 1);
      if (work) await event(client, before.ride_id, work, null, ride.version + 1, { attemptId: before.id });
    });
  }
}
