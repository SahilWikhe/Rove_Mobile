import type { PoolClient } from 'pg';
import { z } from 'zod';
/** Bind only after signature verification. Event bodies never choose the configured source. */
export async function bindWebhookScope(
  client: PoolClient,
  kind: 'payment' | 'payout',
  source: string,
  eventId: string,
) {
  z.enum(['payment', 'payout']).parse(kind);
  z.string()
    .regex(/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/)
    .parse(source);
  z.string()
    .regex(kind === 'payout' ? /^evt_(?:(?:test|live)_)?[a-zA-Z0-9]{1,96}$/ : /^evt_[a-zA-Z0-9]{1,96}$/)
    .parse(eventId);
  await client.query(
    "SELECT set_config('rove.payment_webhook_source',$1,true),set_config('rove.payment_webhook_event',$2,true),set_config('rove.payout_webhook_source',$3,true),set_config('rove.payout_webhook_event',$4,true)",
    [
      kind === 'payment' ? source : '',
      kind === 'payment' ? eventId : '',
      kind === 'payout' ? source : '',
      kind === 'payout' ? eventId : '',
    ],
  );
}
