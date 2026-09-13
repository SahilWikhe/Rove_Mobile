import type { PoolClient } from 'pg';
/** Read bounded ride batches from source-scoped persisted payments, retaining recovery ordering. */
export async function paymentRecoveryCandidates(
  client: PoolClient,
  kind: 'refund' | 'dispute',
  source: string,
  now: Date,
) {
  const table = kind === 'refund' ? 'payment_refund_checks' : 'payment_dispute_checks';
  const selected: Array<{ id: string; intent_id: string }> = [];
  let cursor: { due: string; id: string } | undefined;
  while (selected.length < 100) {
    const page = (
      await client.query<{ id: string; intent_id: string; ride_id: string; due: string }>(
        `SELECT p.id,p.intent_id,p.ride_id,COALESCE(c.requested_at,'-infinity'::timestamptz)::text AS due
       FROM payment_attempts p LEFT JOIN ${table} c ON c.attempt_id=p.id
       WHERE p.source=$1 AND p.intent_id IS NOT NULL
       AND (c.verified_at IS NULL OR c.verified_at<$2) AND (c.requested_at IS NULL OR c.requested_at<$3)
       AND ($4::timestamptz IS NULL OR (COALESCE(c.requested_at,'-infinity'::timestamptz),p.id)>($4::timestamptz,$5::uuid))
       ORDER BY c.requested_at NULLS FIRST,p.id LIMIT 100`,
        [
          source,
          new Date(now.getTime() - 3600000),
          new Date(now.getTime() - 600000),
          cursor?.due ?? null,
          cursor?.id ?? null,
        ],
      )
    ).rows;
    if (!page.length) break;
    await client.query("SELECT set_config('rove.ride_batch',$1,true),set_config('rove.ride_write','',true)", [
      JSON.stringify(page.map((row) => row.ride_id)),
    ]);
    const eligible = (
      await client.query<{ id: string }>(
        "SELECT id FROM rides WHERE id=ANY($1::uuid[]) AND payment_state IN ('paid','review_required')",
        [page.map((row) => row.ride_id)],
      )
    ).rows;
    const ids = new Set(eligible.map((row) => row.id));
    for (const row of page)
      if (ids.has(row.ride_id) && selected.length < 100)
        selected.push({ id: row.id, intent_id: row.intent_id });
    const last = page.at(-1)!;
    cursor = { due: last.due, id: last.id };
    if (page.length < 100) break;
  }
  await client.query("SELECT set_config('rove.ride_batch','',true)");
  return selected;
}
