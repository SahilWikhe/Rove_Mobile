import Stripe from 'stripe';
import { z } from 'zod';
import type { Pool } from 'pg';
import { DomainError } from './errors';
import { transaction } from './transactions';
const supported = new Set([
  'v2.core.account.created',
  'v2.core.account.closed',
  'v2.core.account.updated',
  'v2.core.account[configuration.recipient].capability_status_updated',
  'v2.core.account[configuration.recipient].updated',
  'v2.core.account[requirements].updated',
]);
const Event = z.object({
  id: z.string().regex(/^evt_[a-zA-Z0-9]{1,96}$/),
  type: z.string().min(1).max(150),
  created: z.iso.datetime(),
  livemode: z.boolean(),
  related_object: z.unknown().optional(),
});
export type PayoutEventHint = { id: string; type: string; created: string; accountId: string };
export interface PayoutWebhookVerifier {
  verify(body: Buffer, signature: string): PayoutEventHint | null;
}
const invalid = () => new DomainError('INVALID_PAYOUT_WEBHOOK', 'Invalid payout event.', 400);
export class StripePayoutWebhookVerifier implements PayoutWebhookVerifier {
  private stripe: Stripe;
  constructor(private config: { secretKey: string; webhookSecret: string; live: boolean }) {
    if (
      !new RegExp(`^(sk|rk)_${config.live ? 'live' : 'test'}_[a-zA-Z0-9]+$`).test(config.secretKey) ||
      !/^whsec_[a-zA-Z0-9]+$/.test(config.webhookSecret)
    )
      throw new Error('Invalid payout webhook configuration.');
    this.stripe = new Stripe(config.secretKey, { apiVersion: '2026-08-26.dahlia' });
  }
  verify(body: Buffer, signature: string): PayoutEventHint | null {
    try {
      // SDK validates the raw payload, signature and replay window. Never follow event-provided URLs.
      const notification = this.stripe.parseEventNotification(
        body,
        signature,
        this.config.webhookSecret,
        300,
      );
      const result = Event.safeParse(notification);
      if (!result.success || result.data.livemode !== this.config.live) throw invalid();
      const value = result.data;
      if (!supported.has(value.type)) return null;
      const related = z
        .object({ id: z.string().regex(/^acct_[a-zA-Z0-9]{1,96}$/), type: z.literal('v2.core.account') })
        .safeParse(value.related_object);
      if (!related.success) throw invalid();
      return { id: value.id, type: value.type, created: value.created, accountId: related.data.id };
    } catch {
      throw invalid();
    }
  }
}
/** Commit a minimal signed hint and its reconciliation work together; never store raw personal data. */
export class PayoutWebhookInbox {
  constructor(
    private pool: Pool,
    private verifier: PayoutWebhookVerifier,
    private source: string,
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid payout source.');
  }
  async receive(body: Buffer, signature: string) {
    const hint = this.verifier.verify(body, signature);
    if (!hint) return;
    await transaction(this.pool, async (client) => {
      const row = (
        await client.query<{ id: string }>(
          `INSERT INTO payout_webhook_events(source,event_id,event_type,account_id,provider_created)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(source,event_id) DO NOTHING RETURNING id`,
          [this.source, hint.id, hint.type, hint.accountId, hint.created],
        )
      ).rows[0];
      if (!row) {
        const old = (
          await client.query(
            'SELECT event_type,account_id,provider_created FROM payout_webhook_events WHERE source=$1 AND event_id=$2',
            [this.source, hint.id],
          )
        ).rows[0];
        if (
          !old ||
          old.event_type !== hint.type ||
          old.account_id !== hint.accountId ||
          old.provider_created.getTime() !== Date.parse(hint.created)
        )
          throw new DomainError('PAYOUT_EVENT_CONFLICT', 'Payout event could not be verified.', 409);
        return;
      }
      await client.query('INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES($1,$2,$3,$4)', [
        'payout.reconcile',
        row.id,
        JSON.stringify({ source: this.source, accountId: hint.accountId }),
        `payout-webhook:${row.id}`,
      ]);
    });
  }
}
