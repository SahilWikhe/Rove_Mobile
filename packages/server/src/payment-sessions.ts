import type { Pool } from 'pg';
import type { Actor } from './rides';
import type { PaymentProvider, PaymentReference } from './payment-provider';
import { DomainError } from './errors';
import { transaction } from './transactions';

interface Attempt {
  id: string;
  intent_id: string | null;
  amount_cents: number;
  source: string;
  customer_binding_id: string;
  created_at: Date;
}
const unavailable = () =>
  new DomainError('PAYMENT_SESSION_UNAVAILABLE', 'This ride cannot accept a payment now.', 409);
/** One durable creation attempt per ride. Never persists PaymentSheet client secrets. */
export class PaymentSessions {
  constructor(
    private pool: Pool,
    private provider: PaymentProvider,
    private source: string,
    private now: () => Date = () => new Date(),
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid payment source.');
  }
  async create(actor: Actor, rideId: string) {
    if (actor.role !== 'rider') throw new DomainError('NOT_FOUND', 'Ride not found.', 404);
    const prepared = await transaction(this.pool, async (client) => {
      const ride = (
        await client.query<{ state: string; search_deadline: Date; fare_cents: number; disabled: boolean }>(
          `SELECT r.state,r.search_deadline,r.fare_cents,u.disabled FROM rides r JOIN users u ON u.id=r.rider_id
         WHERE r.id=$1 AND r.rider_id=$2 FOR UPDATE OF r`,
          [rideId, actor.id],
        )
      ).rows[0];
      if (!ride) throw new DomainError('NOT_FOUND', 'Ride not found.', 404);
      if (ride.disabled)
        throw new DomainError('ACCOUNT_DISABLED', 'Contact support for help with your account.', 403);
      const binding = (
        await client.query<{ id: string; customer_id: string }>(
          'SELECT id,customer_id FROM payment_customers WHERE rider_id=$1 AND source=$2',
          [actor.id, this.source],
        )
      ).rows[0];
      if (!binding)
        throw new DomainError('PAYMENT_PROFILE_REQUIRED', 'Set up your payment profile first.', 409);
      let attempt = (await client.query<Attempt>('SELECT * FROM payment_attempts WHERE ride_id=$1', [rideId]))
        .rows[0];
      if (!attempt) {
        if (ride.state !== 'searching' || ride.search_deadline <= this.now()) throw unavailable();
        attempt = (
          await client.query<Attempt>(
            'INSERT INTO payment_attempts(ride_id,customer_binding_id,source,amount_cents,created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [rideId, binding.id, this.source, ride.fare_cents, this.now()],
          )
        ).rows[0]!;
      }
      if (
        attempt.source !== this.source ||
        attempt.customer_binding_id !== binding.id ||
        attempt.amount_cents !== ride.fare_cents
      )
        throw new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment could not be verified.', 503);
      if (!attempt.intent_id && this.now().getTime() - attempt.created_at.getTime() >= 23 * 60 * 60 * 1000)
        throw new DomainError(
          'PAYMENT_CREATION_REVIEW',
          'An earlier payment attempt needs support review.',
          409,
        );
      return { attempt, customerId: binding.customer_id };
    });
    const { attempt, customerId } = prepared;
    const reference = { rideId, attemptId: attempt.id, customerId, amountCents: attempt.amount_cents };
    // Persisted before network I/O. Unknown outcomes reuse this exact key and immutable payload.
    const result = attempt.intent_id
      ? await this.provider.session({ ...reference, intentId: attempt.intent_id })
      : await this.provider.create(reference, `rove:${attempt.id}:create`);
    const payment = result.payment;
    if (
      Object.entries(reference).some(([k, v]) => payment[k as keyof PaymentReference] !== v) ||
      !/^pi_[a-zA-Z0-9]{1,96}$/.test(payment.intentId) ||
      (attempt.intent_id && payment.intentId !== attempt.intent_id) ||
      !result.clientSecret.startsWith(payment.intentId + '_secret_')
    )
      throw new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment could not be verified.', 503);
    const allowed = await transaction(this.pool, async (client) => {
      const ride = (
        await client.query<{ state: string; search_deadline: Date; disabled: boolean }>(
          `SELECT r.state,r.search_deadline,u.disabled FROM rides r JOIN users u ON u.id=r.rider_id
         WHERE r.id=$1 AND r.rider_id=$2 FOR UPDATE OF r`,
          [rideId, actor.id],
        )
      ).rows[0];
      if (!ride) throw new DomainError('NOT_FOUND', 'Ride not found.', 404);
      const mapped = await client.query(
        'UPDATE payment_attempts SET intent_id=$2 WHERE id=$1 AND (intent_id IS NULL OR intent_id=$2)',
        [attempt.id, payment.intentId],
      );
      if (mapped.rowCount !== 1)
        throw new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment could not be verified.', 503);
      await client.query(
        `INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES ('payment.reconcile',$1,$2,$3) ON CONFLICT(dedupe_key) DO NOTHING`,
        [
          attempt.id,
          JSON.stringify({ source: this.source, intentId: payment.intentId }),
          `payment-session:${attempt.id}`,
        ],
      );
      // Commit reference/cleanup job even if cancellation raced the provider request. Do not return its secret.
      return !ride.disabled && ride.state === 'searching' && ride.search_deadline > this.now();
    });
    if (!allowed) throw unavailable();
    return { rideId, clientSecret: result.clientSecret };
  }
}
