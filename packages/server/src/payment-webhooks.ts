import type { Pool } from 'pg';
import { z } from 'zod';
import { DomainError } from './errors';
import { transaction } from './transactions';

export interface PaymentEventHint {
  id: string;
  type: string;
  created: number;
  resourceId: string;
}
export interface PaymentWebhookVerifier {
  verifyWebhook(body: Buffer, signature: string): PaymentEventHint;
}
const Hint = z
  .object({
    id: z.string().regex(/^evt_[a-zA-Z0-9]{1,96}$/),
    type: z.string().min(1).max(100),
    created: z.number().int().min(0).max(2_147_483_647),
    resourceId: z.string().min(1).max(100),
  })
  .strict();
const supported = new Set([
  'payment_intent.created',
  'payment_intent.amount_capturable_updated',
  'payment_intent.requires_action',
  'payment_intent.processing',
  'payment_intent.payment_failed',
  'payment_intent.succeeded',
  'payment_intent.canceled',
]);

const disputeEvents = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
]);
const refundEvents = new Set(['refund.created', 'refund.updated', 'refund.failed']);

/** Durable ingress only. Signed event state is never used as payment authorization. */
export class PaymentWebhookInbox {
  constructor(
    private pool: Pool,
    private verifier: PaymentWebhookVerifier,
    private source: string,
    private refundsEnabled = false,
    private disputesEnabled = false,
  ) {
    // One platform account and mode per endpoint/verifier; never derive this from request input.
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source))
      throw new Error('Payment webhook source must identify an account and mode.');
  }
  async receive(body: Buffer, signature: string): Promise<void> {
    // Authenticate before database work, even for unsupported or duplicate events.
    const parsed = Hint.safeParse(this.verifier.verifyWebhook(body, signature));
    if (!parsed.success) throw new DomainError('INVALID_PAYMENT_WEBHOOK', 'Invalid payment event.', 400);
    const hint = parsed.data;
    const refund = refundEvents.has(hint.type);
    const dispute = disputeEvents.has(hint.type);
    if (!supported.has(hint.type) && !(this.refundsEnabled && refund) && !(this.disputesEnabled && dispute))
      return;
    if (!/^pi_[a-zA-Z0-9]{1,96}$/.test(hint.resourceId))
      throw new DomainError('INVALID_PAYMENT_WEBHOOK', 'Invalid payment event.', 400);
    await transaction(this.pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO payment_webhook_events (source,event_id,event_type,resource_id,provider_created)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source,event_id) DO NOTHING RETURNING id`,
        [this.source, hint.id, hint.type, hint.resourceId, hint.created],
      );
      const row = inserted.rows[0];
      if (!row) {
        const existing = (
          await client.query<{
            event_type: string;
            resource_id: string;
            provider_created: number;
          }>(
            'SELECT event_type,resource_id,provider_created FROM payment_webhook_events WHERE source=$1 AND event_id=$2',
            [this.source, hint.id],
          )
        ).rows[0];
        if (
          !existing ||
          existing.event_type !== hint.type ||
          existing.resource_id !== hint.resourceId ||
          existing.provider_created !== hint.created
        )
          throw new DomainError('PAYMENT_EVENT_CONFLICT', 'Payment event could not be verified.', 409);
        return;
      }
      // Receipt and job commit atomically. A failed enqueue must cause Stripe to retry delivery.
      await client.query(`INSERT INTO outbox (topic,aggregate_id,payload,dedupe_key) VALUES ($1,$2,$3,$4)`, [
        dispute ? 'dispute.reconcile' : refund ? 'refund.reconcile' : 'payment.reconcile',
        row.id,
        JSON.stringify({ source: this.source, intentId: hint.resourceId }),
        `payment-webhook:${row.id}`,
      ]);
    });
  }
}
