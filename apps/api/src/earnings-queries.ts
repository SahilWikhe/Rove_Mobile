import type { Pool } from 'pg';
import { DriverEarnings } from '@rove/contracts';
import { DomainError, type Actor } from '@rove/server';
export async function getEarnings(pool: Pool, actor: Actor) {
  if (actor.role !== 'driver') throw new DomainError('NOT_FOUND', 'Earnings not found.', 404);
  const rows = (
    await pool.query<{
      id: string;
      ride_id: string;
      created_at: Date;
      amount: string;
      total: string;
      count: string;
    }>(
      `SELECT j.id,j.ride_id,j.created_at,(-SUM(l.amount_cents))::text AS amount,
      SUM(-SUM(l.amount_cents)) OVER()::text AS total,COUNT(*) OVER()::text AS count
     FROM ledger_postings l JOIN ledger_journals j ON j.id=l.journal_id
     WHERE l.owner_id=$1 AND l.account='driver_payable' AND j.kind='allocation'
     GROUP BY j.id,j.ride_id,j.created_at ORDER BY j.created_at DESC,j.id DESC LIMIT 50`,
      [actor.id],
    )
  ).rows;
  return DriverEarnings.parse({
    recordedTotal: { amount: Number(rows[0]?.total ?? 0), currency: 'USD' },
    entries: rows.map((row) => ({
      id: row.id,
      rideId: row.ride_id,
      recordedAt: row.created_at.toISOString(),
      amount: { amount: Number(row.amount), currency: 'USD' },
    })),
    hasMore: Number(rows[0]?.count ?? 0) > 50,
    payoutStatus: 'not_configured',
  });
}
