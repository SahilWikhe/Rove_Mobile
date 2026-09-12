import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError } from './errors';
interface Posting {
  account: 'stripe_clearing' | 'rider_funds' | 'driver_payable' | 'platform_revenue';
  ownerId: string | null;
  amountCents: number;
}
interface Capture {
  attemptId: string;
  rideId: string;
  riderId: string;
  receivedCents: number;
  driverId: string | null;
  earningsCents: number;
  completed: boolean;
  fullFare: boolean;
}
async function journal(
  client: PoolClient,
  capture: Capture,
  kind: 'capture' | 'allocation',
  postings: Posting[],
) {
  const key = `${capture.attemptId}:${kind}`;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ rideId: capture.rideId, postings }))
    .digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`ledger:${key}`]);
  const existing = (
    await client.query<{ fingerprint: string }>('SELECT fingerprint FROM ledger_journals WHERE key=$1', [key])
  ).rows[0];
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new DomainError('LEDGER_CONFLICT', 'Payment accounting requires review.', 409);
    return;
  }
  const row = (
    await client.query<{ id: string }>(
      'INSERT INTO ledger_journals(key,fingerprint,attempt_id,ride_id,kind) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [key, fingerprint, capture.attemptId, capture.rideId, kind],
    )
  ).rows[0]!;
  for (const posting of postings)
    await client.query(
      'INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents) VALUES($1,$2,$3,$4)',
      [row.id, posting.account, posting.ownerId, posting.amountCents],
    );
}
/** Positive amounts are debits, negative amounts credits. Every journal is balanced at DB commit. */
export async function recordCapturedFunds(client: PoolClient, input: Capture): Promise<boolean> {
  if (
    !Number.isSafeInteger(input.receivedCents) ||
    input.receivedCents <= 0 ||
    input.receivedCents > 99_999_999
  )
    throw new DomainError('INVALID_LEDGER_AMOUNT', 'Payment accounting requires review.', 409);
  // Serialize financial decisions for this payment with reconciliation and loss allocation.
  await client.query('SELECT id FROM payment_attempts WHERE id=$1 FOR UPDATE', [input.attemptId]);
  await journal(client, input, 'capture', [
    { account: 'stripe_clearing', ownerId: null, amountCents: input.receivedCents },
    { account: 'rider_funds', ownerId: input.riderId, amountCents: -input.receivedCents },
  ]);
  // Preserve captured funds as an unallocated rider liability until completion/earnings are verified.
  if (
    !input.completed ||
    !input.fullFare ||
    !input.driverId ||
    !Number.isSafeInteger(input.earningsCents) ||
    input.earningsCents < 0 ||
    input.earningsCents > input.receivedCents
  )
    return false;
  const allocated = (
    await client.query("SELECT id FROM ledger_journals WHERE attempt_id=$1 AND kind='allocation'", [
      input.attemptId,
    ])
  ).rowCount;
  if (!allocated) {
    const funds = (
      await client.query(
        `SELECT -COALESCE(sum(l.amount_cents),0)::int AS amount FROM ledger_postings l
      JOIN ledger_journals j ON j.id=l.journal_id WHERE j.attempt_id=$1 AND l.account='rider_funds'`,
        [input.attemptId],
      )
    ).rows[0];
    // A refund already released part of this liability. Never allocate the original full fare again.
    if (funds.amount !== input.receivedCents) return false;
  }
  const entries: Posting[] = [
    { account: 'rider_funds', ownerId: input.riderId, amountCents: input.receivedCents },
    { account: 'driver_payable', ownerId: input.driverId, amountCents: -input.earningsCents },
    { account: 'platform_revenue', ownerId: null, amountCents: -(input.receivedCents - input.earningsCents) },
  ];
  await journal(
    client,
    input,
    'allocation',
    entries.filter((entry) => entry.amountCents !== 0),
  );
  return true;
}
