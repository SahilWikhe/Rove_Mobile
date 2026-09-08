import type { Pool } from 'pg';
import { RideReceipt } from '@rove/contracts';
import { DomainError, type Actor } from '@rove/server';
/** One database snapshot: a receipt proves recorded capture, not UI success or an authorization hold. */
export async function getReceipt(pool: Pool, actor: Actor, rideId: string) {
  if (actor.role !== 'rider') throw new DomainError('NOT_FOUND', 'Receipt not found.', 404);
  const rows = (
    await pool.query<{
      fare_cents: number;
      state: string;
      payment_state: string;
      capture_id: string | null;
      created_at: Date | null;
      amount: string | null;
    }>(
      `SELECT r.fare_cents,r.state,r.payment_state,receipt.id AS capture_id,receipt.created_at,receipt.amount
     FROM rides r LEFT JOIN LATERAL (
       SELECT j.id,j.created_at,SUM(l.amount_cents)::text AS amount FROM ledger_journals j
       JOIN ledger_postings l ON l.journal_id=j.id
       JOIN payment_attempts p ON p.id=j.attempt_id AND p.ride_id=j.ride_id
       JOIN payment_customers c ON c.id=p.customer_binding_id AND c.rider_id=r.rider_id AND c.source=p.source
       WHERE j.ride_id=r.id AND j.kind='capture' AND l.account='stripe_clearing'
       GROUP BY j.id,j.created_at
     ) receipt ON true WHERE r.id=$1 AND r.rider_id=$2`,
      [rideId, actor.id],
    )
  ).rows;
  if (!rows.length) throw new DomainError('NOT_FOUND', 'Receipt not found.', 404);
  if (rows.length !== 1) throw new DomainError('RECEIPT_REVIEW', 'This payment record needs review.', 409);
  const row = rows[0]!;
  if (!row.capture_id || !row.created_at || row.amount === null)
    throw new DomainError(
      'RECEIPT_PENDING',
      'Your receipt will appear after payment capture is recorded.',
      409,
    );
  return RideReceipt.parse({
    id: row.capture_id,
    rideId,
    recordedAt: row.created_at.toISOString(),
    quotedFare: { amount: row.fare_cents, currency: 'USD' },
    capturedAmount: { amount: Number(row.amount), currency: 'USD' },
    rideState: row.state,
    paymentState: row.payment_state,
  });
}
