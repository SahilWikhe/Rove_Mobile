import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { RefundSnapshot } from './payment-provider';
import { DomainError } from './errors';
export const RefundBalance = z
  .object({
    id: z.string().regex(/^txn_[a-zA-Z0-9]{1,96}$/),
    refundId: z.string().regex(/^re_[a-zA-Z0-9]{1,96}$/),
    kind: z.enum(['refund', 'refund_failure']),
    amountCents: z.number().int().min(-99_999_999).max(99_999_999),
    feeCents: z.number().int().min(-99_999_999).max(99_999_999),
    netCents: z.number().int().min(-199_999_998).max(199_999_998),
  })
  .strict();
export const RefundBalances = z.array(RefundBalance).max(2);
const mismatch = () =>
  new DomainError(
    'REFUND_ACCOUNTING_REVIEW',
    'Refund accounting requires verified provider balance records.',
    503,
  );
/** Records processor balance movements, not customer receipt status or a commercial loss allocation. */
export async function recordRefundBalances(
  client: PoolClient,
  input: {
    source: string;
    attemptId: string;
    rideId: string;
    receivedCents: number;
    refunds: RefundSnapshot[];
  },
) {
  const movements = input.refunds.flatMap((refund) => {
    if (refund.balanceTransactions === undefined) throw mismatch();
    const parsed = RefundBalances.safeParse(refund.balanceTransactions);
    if (!parsed.success || (refund.status === 'succeeded' && !parsed.data.some((b) => b.kind === 'refund')))
      throw mismatch();
    const kinds = new Set<string>();
    for (const balance of parsed.data) {
      if (
        kinds.has(balance.kind) ||
        balance.refundId !== refund.id ||
        balance.amountCents !== (balance.kind === 'refund' ? -refund.amountCents : refund.amountCents) ||
        balance.netCents !== balance.amountCents - balance.feeCents
      )
        throw mismatch();
      kinds.add(balance.kind);
    }
    if (kinds.has('refund_failure') && !kinds.has('refund')) throw mismatch();
    return parsed.data;
  });
  if (!movements.length) return;
  const capture = (
    await client.query(
      `SELECT count(*)::int AS count,sum(p.amount_cents)::int AS amount
 FROM ledger_journals j JOIN ledger_postings p ON p.journal_id=j.id AND p.account='stripe_clearing'
 WHERE j.attempt_id=$1 AND j.ride_id=$2 AND j.kind='capture'`,
      [input.attemptId, input.rideId],
    )
  ).rows[0];
  if (capture.count !== 1 || capture.amount !== input.receivedCents) throw mismatch();
  const seen = new Set<string>();
  for (const movement of movements.sort((a, b) => a.id.localeCompare(b.id))) {
    if (seen.has(movement.id)) throw mismatch();
    seen.add(movement.id);
    const key = `refund-balance:${input.source}:${movement.id}`;
    const postings = [
      { account: 'stripe_clearing', amount: movement.netCents },
      { account: 'refund_suspense', amount: -movement.amountCents },
      { account: 'processor_fees', amount: movement.feeCents },
    ].filter((p) => p.amount !== 0);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ attemptId: input.attemptId, rideId: input.rideId, movement, postings }))
      .digest('hex');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    const prior = (await client.query('SELECT fingerprint FROM ledger_journals WHERE key=$1', [key])).rows[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw mismatch();
      continue;
    }
    const journal = (
      await client.query(
        `INSERT INTO ledger_journals(key,fingerprint,attempt_id,ride_id,kind) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [
          key,
          fingerprint,
          input.attemptId,
          input.rideId,
          movement.kind === 'refund' ? 'refund_balance' : 'refund_failure',
        ],
      )
    ).rows[0];
    for (const posting of postings)
      await client.query(
        'INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents) VALUES($1,$2,NULL,$3)',
        [journal.id, posting.account, posting.amount],
      );
  }
}
