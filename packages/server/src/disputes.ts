import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PaymentReference, PaymentSnapshot } from './payment-provider';
import type { JobHandler } from './outbox';
import type { Actor } from './rides';
import { transaction } from './transactions';
import { requireStaffPermission } from './staff-access';
import { DomainError } from './errors';
import { DisputeStatus, StaffDisputeQueue } from '@rove/contracts';
export const DisputeId = z.string().regex(/^(du|dp)_[a-zA-Z0-9]{1,96}$/);
const signed = z.number().int().min(-99_999_999).max(99_999_999);
export const DisputeBalance = z
  .object({
    id: z.string().regex(/^txn_[a-zA-Z0-9]{1,96}$/),
    disputeId: DisputeId,
    amountCents: signed,
    feeCents: signed,
    netCents: z.number().int().min(-199_999_998).max(199_999_998),
  })
  .strict();
export const DisputeSnapshot = z
  .object({
    id: DisputeId,
    intentId: z.string().regex(/^pi_[a-zA-Z0-9]{1,96}$/),
    amountCents: z.number().int().positive().max(99_999_999),
    status: DisputeStatus,
    reason: z.string().regex(/^[a-z_]{1,64}$/),
    created: z.number().int().min(0).max(2147483647),
    dueBy: z.number().int().min(0).max(2147483647).nullable(),
    balanceTransactions: z.array(DisputeBalance).max(2),
  })
  .strict();
export type DisputeSnapshot = z.infer<typeof DisputeSnapshot>;
export interface DisputeProvider {
  disputes(reference: PaymentReference): Promise<{ payment: PaymentSnapshot; disputes: DisputeSnapshot[] }>;
}
const History = z.array(DisputeSnapshot).max(1000);
const closed = new Set(['won', 'warning_closed', 'prevented']);
const mismatch = () =>
  new DomainError('DISPUTE_REVIEW_REQUIRED', 'Dispute records require provider verification.', 503);
function blocked(disputes: DisputeSnapshot[]) {
  return disputes.some(
    (d) => !closed.has(d.status) || d.balanceTransactions.reduce((sum, b) => sum + b.netCents, 0) !== 0,
  );
}
async function recordBalances(
  client: PoolClient,
  reference: PaymentReference,
  source: string,
  receivedCents: number,
  disputes: DisputeSnapshot[],
) {
  const movements = disputes.flatMap((d) => d.balanceTransactions).sort((a, b) => a.id.localeCompare(b.id));
  if (!movements.length) return;
  const capture = (
    await client.query(
      `SELECT count(*)::int AS count,sum(l.amount_cents)::int AS amount FROM ledger_journals j JOIN ledger_postings l ON l.journal_id=j.id AND l.account='stripe_clearing' WHERE j.attempt_id=$1 AND j.ride_id=$2 AND j.kind='capture'`,
      [reference.attemptId, reference.rideId],
    )
  ).rows[0];
  if (capture.count !== 1 || capture.amount !== receivedCents) throw mismatch();
  for (const movement of movements) {
    const postings = [
      { account: 'stripe_clearing', amount: movement.netCents },
      { account: 'dispute_suspense', amount: -movement.amountCents },
      { account: 'processor_fees', amount: movement.feeCents },
    ].filter((p) => p.amount !== 0);
    if (postings.length < 2) throw mismatch();
    const key = `dispute-balance:${source}:${movement.id}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ reference, movement, postings }))
      .digest('hex');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    const prior = (await client.query('SELECT fingerprint FROM ledger_journals WHERE key=$1', [key])).rows[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw mismatch();
      continue;
    }
    const journal = (
      await client.query(
        "INSERT INTO ledger_journals(key,fingerprint,attempt_id,ride_id,kind) VALUES($1,$2,$3,$4,'dispute_balance') RETURNING id",
        [key, fingerprint, reference.attemptId, reference.rideId],
      )
    ).rows[0];
    for (const posting of postings)
      await client.query(
        'INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents) VALUES($1,$2,NULL,$3)',
        [journal.id, posting.account, posting.amount],
      );
  }
}
export class DisputeReconciler {
  constructor(
    private pool: Pool,
    private provider: DisputeProvider,
    private source: string,
    private now: () => Date = () => new Date(),
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid dispute source.');
  }
  private async reference(client: PoolClient, intentId: string, lock = false): Promise<PaymentReference> {
    const row = (
      await client.query(
        `SELECT p.*,c.customer_id FROM payment_attempts p JOIN payment_customers c ON c.id=p.customer_binding_id AND c.source=p.source JOIN rides r ON r.id=p.ride_id AND r.rider_id=c.rider_id AND r.fare_cents=p.amount_cents WHERE p.source=$1 AND p.intent_id=$2 ${lock ? 'FOR UPDATE OF p,r' : ''}`,
        [this.source, intentId],
      )
    ).rows[0];
    if (!row) throw mismatch();
    return {
      attemptId: row.id,
      rideId: row.ride_id,
      intentId,
      customerId: row.customer_id,
      amountCents: row.amount_cents,
    };
  }
  readonly handle: JobHandler = async (job) => {
    const input = z
      .object({ source: z.literal(this.source), intentId: z.string().regex(/^pi_[a-zA-Z0-9]{1,96}$/) })
      .strict()
      .parse(job.payload);
    await this.reconcile(input.intentId);
  };
  async reconcile(intentId: string) {
    const reference = await transaction(this.pool, (c) => this.reference(c, intentId));
    await this.pool.query(
      'INSERT INTO payment_dispute_checks(attempt_id) VALUES($1) ON CONFLICT DO NOTHING',
      [reference.attemptId],
    );
    const before = (
      await this.pool.query('SELECT * FROM payment_dispute_checks WHERE attempt_id=$1', [reference.attemptId])
    ).rows[0];
    const result = await this.provider.disputes(reference);
    const parsed = History.safeParse(result.disputes);
    if (
      !parsed.success ||
      Object.entries(reference).some(([k, v]) => result.payment[k as keyof PaymentReference] !== v) ||
      !Number.isSafeInteger(result.payment.receivedCents) ||
      result.payment.receivedCents < 0 ||
      result.payment.receivedCents > reference.amountCents
    )
      throw mismatch();
    const disputes = parsed.data.sort((a, b) => a.id.localeCompare(b.id));
    const ids = new Set<string>(),
      balances = new Set<string>();
    for (const d of disputes) {
      if (d.intentId !== intentId || ids.has(d.id)) throw mismatch();
      ids.add(d.id);
      for (const b of d.balanceTransactions) {
        if (b.disputeId !== d.id || b.netCents !== b.amountCents - b.feeCents || balances.has(b.id))
          throw mismatch();
        balances.add(b.id);
      }
    }
    const previous = History.parse(before.disputes);
    for (const old of previous) {
      const next = disputes.find((d) => d.id === old.id);
      if (
        !next ||
        old.intentId !== next.intentId ||
        old.amountCents !== next.amountCents ||
        old.created !== next.created
      )
        throw mismatch();
      for (const movement of old.balanceTransactions)
        if (
          JSON.stringify(next.balanceTransactions.find((b) => b.id === movement.id)) !==
          JSON.stringify(movement)
        )
          throw mismatch();
    }
    const changed = JSON.stringify(previous) !== JSON.stringify(disputes) || !before.verified_at;
    await transaction(this.pool, async (client) => {
      const current = await this.reference(client, intentId, true);
      if (JSON.stringify(current) !== JSON.stringify(reference)) throw mismatch();
      const check = (
        await client.query('SELECT revision FROM payment_dispute_checks WHERE attempt_id=$1 FOR UPDATE', [
          reference.attemptId,
        ])
      ).rows[0];
      if (check.revision !== before.revision)
        throw new DomainError('DISPUTE_RETRY', 'Dispute verification changed. Retry.', 503);
      await recordBalances(client, reference, this.source, result.payment.receivedCents, disputes);
      await client.query(
        'UPDATE payment_dispute_checks SET revision=revision+1,disputes=$2,verified_at=$3 WHERE attempt_id=$1',
        [reference.attemptId, JSON.stringify(disputes), this.now()],
      );
      if (changed)
        await client.query(
          'INSERT INTO payment_dispute_observations(attempt_id,revision,disputes,verified_at) VALUES($1,$2,$3,$4)',
          [reference.attemptId, before.revision + 1, JSON.stringify(disputes), this.now()],
        );
    });
  }
  async assertRefundable(client: PoolClient, attemptId: string) {
    const row = (
      await client.query('SELECT * FROM payment_dispute_checks WHERE attempt_id=$1 FOR SHARE', [attemptId])
    ).rows[0];
    if (
      !row?.verified_at ||
      row.verified_at.getTime() < this.now().getTime() - 300000 ||
      row.verified_at.getTime() > this.now().getTime() + 10000 ||
      blocked(History.parse(row.disputes))
    )
      throw new DomainError(
        'DISPUTE_PAYMENT_HOLD',
        'Refresh dispute verification and resolve the payment review before refunding.',
        409,
      );
  }
  async refresh(actor: Actor, rawRideId: string) {
    const rideId = z.uuid().parse(rawRideId);
    const intentId = await transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, 'payments.dispute.review');
      const row = (
        await client.query('SELECT intent_id FROM payment_attempts WHERE ride_id=$1 AND source=$2', [
          rideId,
          this.source,
        ])
      ).rows[0];
      if (!row?.intent_id) throw mismatch();
      return row.intent_id as string;
    });
    await this.reconcile(intentId);
    return { verified: true };
  }
  async queue(actor: Actor, raw: unknown) {
    const query = z
      .object({ cursor: z.string().max(512).optional(), status: DisputeStatus.optional() })
      .strict()
      .parse(raw);
    const Cursor = z
      .object({ due: z.number().int().min(0).max(2147483647), attempt: z.uuid(), dispute: DisputeId })
      .strict();
    let cursor: z.infer<typeof Cursor> | undefined;
    if (query.cursor) {
      try {
        cursor = Cursor.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      } catch {
        throw new DomainError('INVALID_CURSOR', 'Invalid dispute queue cursor.', 400);
      }
    }
    return transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, 'payments.dispute.review');
      const result = await client.query(
        `SELECT p.id AS attempt_id,p.ride_id,c.verified_at,d.item,COALESCE((d.item->>'dueBy')::bigint,2147483647) AS due FROM payment_dispute_checks c JOIN payment_attempts p ON p.id=c.attempt_id CROSS JOIN LATERAL jsonb_array_elements(c.disputes) d(item) WHERE p.source=$1 AND ($5::text IS NULL OR d.item->>'status'=$5) AND (COALESCE((d.item->>'dueBy')::bigint,2147483647),p.id,d.item->>'id')>($2::bigint,$3::uuid,$4::text) ORDER BY due,p.id,d.item->>'id' LIMIT 51`,
        [
          this.source,
          cursor?.due ?? -1,
          cursor?.attempt ?? '00000000-0000-0000-0000-000000000000',
          cursor?.dispute ?? '',
          query.status ?? null,
        ],
      );
      const rows = result.rows.slice(0, 50),
        last = rows.at(-1);
      return StaffDisputeQueue.parse({
        items: rows.map((row) => {
          const d = DisputeSnapshot.parse(row.item);
          return {
            id: d.id,
            rideId: row.ride_id,
            amount: { amount: d.amountCents, currency: 'USD' },
            status: d.status,
            reason: d.reason,
            dueAt: d.dueBy === null ? null : new Date(d.dueBy * 1000).toISOString(),
            verifiedAt: row.verified_at.toISOString(),
            settlementBlocked: row.verified_at.getTime() < this.now().getTime() - 300000 || blocked([d]),
          };
        }),
        nextCursor:
          result.rows.length > 50 && last
            ? Buffer.from(
                JSON.stringify({ due: Number(last.due), attempt: last.attempt_id, dispute: last.item.id }),
              ).toString('base64url')
            : null,
      });
    });
  }
  async sweep() {
    return transaction(this.pool, async (client) => {
      const candidates = await client.query(
        `SELECT p.id,p.intent_id FROM payment_attempts p JOIN rides r ON r.id=p.ride_id LEFT JOIN payment_dispute_checks c ON c.attempt_id=p.id WHERE p.source=$1 AND p.intent_id IS NOT NULL AND r.payment_state IN ('paid','review_required') AND (c.verified_at IS NULL OR c.verified_at<$2) AND (c.requested_at IS NULL OR c.requested_at<$3) ORDER BY c.requested_at NULLS FIRST,p.id LIMIT 100`,
        [this.source, new Date(this.now().getTime() - 3600000), new Date(this.now().getTime() - 600000)],
      );
      let count = 0;
      for (const row of candidates.rows) {
        await client.query(
          'INSERT INTO payment_dispute_checks(attempt_id,requested_at) VALUES($1,$2) ON CONFLICT(attempt_id) DO UPDATE SET requested_at=EXCLUDED.requested_at',
          [row.id, this.now()],
        );
        const queued = await client.query(
          "INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES('dispute.reconcile',$1,$2,$3) ON CONFLICT DO NOTHING",
          [
            row.id,
            JSON.stringify({ source: this.source, intentId: row.intent_id }),
            `dispute-recovery:${row.id}:${Math.floor(this.now().getTime() / 3600000)}`,
          ],
        );
        count += queued.rowCount ?? 0;
      }
      return count;
    });
  }
}
