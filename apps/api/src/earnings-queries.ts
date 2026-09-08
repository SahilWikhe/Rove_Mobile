import type { Pool } from 'pg';
import { z } from 'zod';
import { DriverEarnings, DriverTripEarnings } from '@rove/contracts';
import { DomainError, type Actor } from '@rove/server';
export async function getEarnings(pool: Pool, actor: Actor, before?: string) {
  if (actor.role !== 'driver') throw new DomainError('NOT_FOUND', 'Earnings not found.', 404);
  if (before !== undefined && !z.uuid().safeParse(before).success)
    throw new DomainError('INVALID_CURSOR', 'Refresh your earnings history.', 400);
  const rows = (
    await pool.query<{
      id: string | null;
      ride_id: string;
      created_at: Date;
      amount: string;
      total: string;
      cursor_valid: boolean;
    }>(
      `WITH owned AS MATERIALIZED (
       SELECT j.id,j.ride_id,j.created_at,(-SUM(l.amount_cents))::text AS amount
       FROM ledger_postings l JOIN ledger_journals j ON j.id=l.journal_id
       WHERE l.owner_id=$1 AND l.account='driver_payable' AND j.kind='allocation'
       GROUP BY j.id,j.ride_id,j.created_at
     ), boundary AS (SELECT id,created_at FROM owned WHERE id=$2::uuid),
     page AS (
       SELECT * FROM owned WHERE $2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM boundary)
       ORDER BY created_at DESC,id DESC LIMIT 51
     ), totals AS (SELECT COALESCE(SUM(amount::bigint),0)::text AS total FROM owned)
     SELECT p.*,t.total,($2::uuid IS NULL OR EXISTS(SELECT 1 FROM boundary)) AS cursor_valid
     FROM totals t LEFT JOIN page p ON true ORDER BY p.created_at DESC,p.id DESC`,
      [actor.id, before ?? null],
    )
  ).rows;
  if (!rows[0]?.cursor_valid) throw new DomainError('INVALID_CURSOR', 'Refresh your earnings history.', 400);
  const records = rows.filter((row) => row.id !== null);
  const hasMore = records.length > 50;
  const page = records.slice(0, 50);
  return DriverEarnings.parse({
    recordedTotal: { amount: Number(rows[0].total), currency: 'USD' },
    entries: page.map((row) => ({
      id: row.id,
      rideId: row.ride_id,
      recordedAt: row.created_at.toISOString(),
      amount: { amount: Number(row.amount), currency: 'USD' },
    })),
    hasMore,
    nextCursor: hasMore ? page[49]!.id : null,
    payoutStatus: 'not_configured',
  });
}

export async function getTripEarnings(pool: Pool, actor: Actor, rideId: string) {
  if (actor.role !== 'driver') throw new DomainError('NOT_FOUND', 'Trip earnings not found.', 404);
  const { rows } = await pool.query<{
    earnings_cents: number;
    amount: string | null;
    recorded_at: Date | null;
    journals: string;
  }>(
    `SELECT r.earnings_cents, a.amount, a.recorded_at, a.journals
      FROM rides r LEFT JOIN LATERAL (
        SELECT (-SUM(l.amount_cents))::text AS amount, MAX(j.created_at) AS recorded_at,
               COUNT(DISTINCT j.id)::text AS journals
        FROM ledger_journals j JOIN ledger_postings l ON l.journal_id=j.id
        WHERE j.ride_id=r.id AND j.kind='allocation'
          AND l.account='driver_payable' AND l.owner_id=$1
      ) a ON true
      WHERE r.id=$2 AND r.driver_id=$1 AND r.state='completed'`,
    [actor.id, rideId],
  );
  const row = rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 'Trip earnings not found.', 404);
  if (Number(row.journals) > 1)
    throw new DomainError('EARNINGS_REVIEW_REQUIRED', 'This trip’s earnings need review.', 409);
  return DriverTripEarnings.parse({
    rideId,
    estimatedAmount: { amount: row.earnings_cents, currency: 'USD' },
    recordedAmount: row.amount === null ? null : { amount: Number(row.amount), currency: 'USD' },
    recordedAt: row.recorded_at?.toISOString() ?? null,
    payoutStatus: 'not_configured',
  });
}
