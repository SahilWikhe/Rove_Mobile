import { bindUserRead } from './user-scope';
import { enqueueOutbox } from './outbox-enqueue';
import { bindLedgerAttempt } from './ledger-scope';
import { appendLedgerJournal } from './ledger-append';
import { appendAudit } from './audit';
import { bindPayoutScope } from './payout-scope';
import { bindTransferScope } from './transfer-scope';
import { bindRefundOperationScope } from './refund-operation-scope';
import { bindRefundScope } from './refund-scope';
import { bindPaymentCustomerRead } from './payment-customer-scope';
import type { CaptureFees } from './capture-fees';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { DriverTransferAuthorization, DriverTransferOperation } from '@rove/contracts';
import type { Actor } from './rides';
import type { JobHandler } from './outbox';
import type { PaymentReference } from './payment-provider';
import type {
  DriverTransferProvider,
  DriverTransferReference,
  DriverTransferSnapshot,
} from './driver-transfer-provider';
import type { RefundReconciler } from './refund-reconciliation';
import type { DisputeReconciler } from './disputes';
import { requireStaffPermission } from './staff-access';
import { command, transaction } from './transactions';
import { DomainError } from './errors';
const permission = 'payments.transfer';
const review = () =>
  new DomainError(
    'TRANSFER_REVIEW_REQUIRED',
    'Review verified earnings and financial holds before transferring.',
    409,
  );
const Amount = z.number().int().min(1).max(99_999_999);
const Signed = z.number().int().min(-199_999_998).max(199_999_998);
const Snapshot = z
  .object({
    id: z.string().regex(/^tr_[a-zA-Z0-9]{1,96}$/),
    created: z.number().int().positive(),
    amountCents: Amount,
    reversedCents: z.number().int().min(0).max(99_999_999),
    movements: z
      .array(
        z
          .object({
            id: z.string().regex(/^txn_[a-zA-Z0-9]{1,96}$/),
            sourceId: z.string(),
            kind: z.enum(['transfer', 'transfer_refund']),
            amountCents: Signed,
            feeCents: Signed,
            netCents: Signed,
          })
          .strict(),
      )
      .min(1)
      .max(1001),
  })
  .strict();
interface Operation {
  id: string;
  attempt_id: string;
  driver_id: string;
  payout_binding_id: string;
  account_id: string;
  amount_cents: number;
  state: string;
  first_attempt_at: Date | null;
  charge_id: string | null;
  provider_transfer_id: string | null;
  revision: number;
  reversed_cents: number;
  checked_at: Date | null;
  created_at: Date;
}
interface Context extends PaymentReference {
  driverId: string;
  state: string;
}
type Posting = { account: string; owner: string | null; amount: number };
/** Explicit staff-approved transfers, not a commercial split or bank-payout scheduler. */
export class DriverTransfers {
  constructor(
    private pool: Pool,
    private provider: DriverTransferProvider,
    private refunds: Pick<RefundReconciler, 'reconcile'>,
    private disputes: Pick<DisputeReconciler, 'reconcile' | 'assertRefundable'>,
    private source: string,
    private captureFees: Pick<CaptureFees, 'reconcile' | 'assertReady'>,
    private now: () => Date = () => new Date(),
  ) {}
  private async context(c: PoolClient, rideId: string): Promise<Context> {
    await bindPaymentCustomerRead(c, this.source, { rideId });
    const p = (
      await c.query(
        `SELECT p.*,r.driver_id,r.state,c.customer_id FROM payment_attempts p
      JOIN rides r ON r.id=p.ride_id AND r.fare_cents=p.amount_cents
      JOIN payment_customers c ON c.id=p.customer_binding_id AND c.source=p.source AND c.rider_id=r.rider_id
      WHERE p.ride_id=$1 AND p.source=$2 AND p.intent_id IS NOT NULL FOR UPDATE OF p,r`,
        [rideId, this.source],
      )
    ).rows[0];
    if (!p?.driver_id) throw review();
    await bindTransferScope(c, this.source, { attemptId: p.id });
    return {
      intentId: p.intent_id,
      rideId,
      attemptId: p.id,
      customerId: p.customer_id,
      amountCents: p.amount_cents,
      driverId: p.driver_id,
      state: p.state,
    };
  }
  private async operation(c: PoolClient, operationId: string, p: Context) {
    await bindTransferScope(c, this.source, { attemptId: p.attemptId, operationId, writable: true });
    const op = (
      await c.query<Operation>(
        'SELECT * FROM driver_transfer_operations WHERE id=$1 AND attempt_id=$2 FOR UPDATE',
        [operationId, p.attemptId],
      )
    ).rows[0];
    if (!op || op.driver_id !== p.driverId) throw review();
    return op;
  }
  private dto(op: Operation) {
    return DriverTransferOperation.parse({
      id: op.id,
      state: op.state,
      amountCents: op.amount_cents,
      reversedCents: op.reversed_cents,
      createdAt: op.created_at.toISOString(),
      checkedAt: op.checked_at?.toISOString() ?? null,
    });
  }
  private reference(op: Operation, p: Context): DriverTransferReference {
    if (!op.first_attempt_at || !op.charge_id) throw review();
    return {
      operationId: op.id,
      firstAttemptAt: op.first_attempt_at.toISOString(),
      driverId: op.driver_id,
      bindingId: op.payout_binding_id,
      accountId: op.account_id,
      chargeId: op.charge_id,
      amountCents: op.amount_cents,
      payment: {
        intentId: p.intentId,
        rideId: p.rideId,
        attemptId: p.attemptId,
        customerId: p.customerId,
        amountCents: p.amountCents,
      },
    };
  }
  private async eligible(c: PoolClient, p: Context, exclude?: string) {
    if (p.state !== 'completed') throw review();
    await bindUserRead(c, p.driverId);
    const d = (
      await c.query(
        `SELECT u.disabled,u.role,d.approved,d.eligibility_expires_at FROM drivers d JOIN users u ON u.id=d.id WHERE d.id=$1 FOR SHARE OF d,u`,
        [p.driverId],
      )
    ).rows[0];
    if (
      !d ||
      d.disabled ||
      d.role !== 'driver' ||
      !d.approved ||
      !d.eligibility_expires_at ||
      d.eligibility_expires_at <= this.now()
    )
      throw review();
    await this.captureFees.assertReady(c, p.attemptId, p.amountCents);
    await this.disputes.assertRefundable(c, p.attemptId);
    await bindRefundScope(c, this.source, 'read', p.attemptId);
    const f = (
      await c.query('SELECT * FROM payment_refund_checks WHERE attempt_id=$1 FOR SHARE', [p.attemptId])
    ).rows[0];
    if (
      !f?.verified_at ||
      f.verified_at < new Date(this.now().getTime() - 300000) ||
      f.verified_at > new Date(this.now().getTime() + 10000) ||
      f.received_cents !== p.amountCents
    )
      throw review();
    const refunds = z
      .array(
        z.object({
          id: z.string(),
          amountCents: Amount,
          status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
        }),
      )
      .parse(f.refunds);
    if (refunds.some((r) => ['pending', 'requires_action'].includes(r.status))) throw review();
    await bindRefundOperationScope(c, this.source, { attemptId: p.attemptId });
    const operations = (
      await c.query('SELECT provider_refund_id,amount_cents FROM refund_operations WHERE attempt_id=$1', [
        p.attemptId,
      ])
    ).rows;
    if (
      operations.some(
        (o) => !refunds.some((r) => r.id === o.provider_refund_id && r.amountCents === o.amount_cents),
      )
    )
      throw review();
    await bindLedgerAttempt(c, p.attemptId);
    const sums = (
      await c.query(
        `SELECT l.account,COALESCE(sum(l.amount_cents),0)::int AS amount FROM ledger_postings l
      JOIN ledger_journals j ON j.id=l.journal_id WHERE j.attempt_id=$1 GROUP BY l.account`,
        [p.attemptId],
      )
    ).rows;
    if (
      sums.some(
        (s) => ['refund_suspense', 'dispute_suspense', 'rider_funds'].includes(s.account) && s.amount !== 0,
      )
    )
      throw review();
    const capture = (
      await c.query(
        `SELECT count(*)::int AS count,sum(l.amount_cents)::int AS amount FROM ledger_postings l JOIN ledger_journals j ON j.id=l.journal_id WHERE j.attempt_id=$1 AND j.kind='capture' AND l.account='stripe_clearing'`,
        [p.attemptId],
      )
    ).rows[0];
    if (capture.count !== 1 || capture.amount !== p.amountCents) throw review();
    if (
      (
        await c.query(
          `SELECT id FROM driver_transfer_operations WHERE attempt_id=$1 AND state IN ('queued','review_required') AND ($2::uuid IS NULL OR id<>$2)`,
          [p.attemptId, exclude ?? null],
        )
      ).rowCount
    )
      throw review();
    await bindPayoutScope(c, this.source, { driverId: p.driverId });
    const b = (
      await c.query(`SELECT * FROM driver_payout_accounts WHERE driver_id=$1 AND source=$2 FOR SHARE`, [
        p.driverId,
        this.source,
      ])
    ).rows[0];
    if (!b?.account_id) throw review();
    const payable = (
      await c.query(
        `SELECT -COALESCE(sum(l.amount_cents),0)::int AS amount FROM ledger_postings l JOIN ledger_journals j ON j.id=l.journal_id WHERE j.attempt_id=$1 AND l.account='driver_payable' AND l.owner_id=$2`,
        [p.attemptId, p.driverId],
      )
    ).rows[0].amount as number;
    return { bindingId: b.id as string, accountId: b.account_id as string, payable };
  }
  private async reserved(c: PoolClient, p: Context, op: Operation) {
    await bindLedgerAttempt(c, p.attemptId);
    const rows = (
      await c.query(
        `SELECT l.account,l.owner_id,l.amount_cents FROM ledger_journals j
      JOIN ledger_postings l ON l.journal_id=j.id WHERE j.key=$1 AND j.attempt_id=$2 AND j.ride_id=$3 AND j.kind='driver_transfer_reserve'`,
        [`driver-transfer:${op.id}:reserve`, p.attemptId, p.rideId],
      )
    ).rows;
    if (
      rows.length !== 2 ||
      rows.some((r) => r.owner_id !== op.driver_id) ||
      !rows.some((r) => r.account === 'driver_payable' && r.amount_cents === op.amount_cents) ||
      !rows.some((r) => r.account === 'driver_transfer_pending' && r.amount_cents === -op.amount_cents)
    )
      throw review();
  }
  private async journal(c: PoolClient, p: Context, key: string, kind: string, entries: Posting[]) {
    const postings = entries.filter((e) => e.amount !== 0);
    if (
      postings.length < 2 ||
      postings.some((e) => !Number.isSafeInteger(e.amount)) ||
      postings.reduce((s, e) => s + e.amount, 0) !== 0
    )
      throw review();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ attemptId: p.attemptId, rideId: p.rideId, kind, postings }))
      .digest('hex');
    await bindLedgerAttempt(c, p.attemptId);
    const prior = (await c.query('SELECT id,fingerprint FROM ledger_journals WHERE key=$1', [key])).rows[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw review();
      return prior.id as string;
    }
    return appendLedgerJournal(
      c,
      { key, fingerprint, attemptId: p.attemptId, rideId: p.rideId, kind },
      postings.map((e) => ({ account: e.account, ownerId: e.owner, amountCents: e.amount })),
    );
  }
  async authorize(actor: Actor, rawRideId: string, raw: unknown, key: string) {
    const rideId = z.uuid().parse(rawRideId),
      input = DriverTransferAuthorization.parse(raw);
    await transaction(this.pool, (c) => requireStaffPermission(c, actor, permission));
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'driver.transfer.authorize', rideId, ...input },
      async (c) => {
        await requireStaffPermission(c, actor, permission);
        const p = await this.context(c, rideId),
          b = await this.eligible(c, p);
        if (input.amountCents > b.payable) throw review();
        const op = (
          await c.query<Operation>(
            `INSERT INTO driver_transfer_operations(attempt_id,driver_id,payout_binding_id,account_id,authorized_by,amount_cents,policy_reference)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [
              p.attemptId,
              p.driverId,
              b.bindingId,
              b.accountId,
              actor.id,
              input.amountCents,
              input.policyReference,
            ],
          )
        ).rows[0]!;
        await this.journal(c, p, `driver-transfer:${op.id}:reserve`, 'driver_transfer_reserve', [
          { account: 'driver_payable', owner: p.driverId, amount: op.amount_cents },
          { account: 'driver_transfer_pending', owner: p.driverId, amount: -op.amount_cents },
        ]);
        await enqueueOutbox(c, {
          topic: 'transfer.execute',
          aggregateId: op.id,
          payload: JSON.stringify({ source: this.source, operationId: op.id }),
          dedupeKey: `transfer-execute:${op.id}`,
        });
        await appendAudit(
          c,
          actor.id,
          'staff.driver_transfer_authorized',
          op.id,
          JSON.stringify({ rideId, ...input }),
        );
        return this.dto(op);
      },
    );
  }
  async list(actor: Actor, rawRideId: string) {
    const rideId = z.uuid().parse(rawRideId);
    return transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, permission);
      const p = await this.context(c, rideId);
      return {
        operations: (
          await c.query<Operation>(
            'SELECT * FROM driver_transfer_operations WHERE attempt_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
            [p.attemptId],
          )
        ).rows.map((o) => this.dto(o)),
      };
    });
  }
  async cancel(actor: Actor, rawRideId: string, rawId: string, key: string) {
    const rideId = z.uuid().parse(rawRideId),
      operationId = z.uuid().parse(rawId);
    await transaction(this.pool, (c) => requireStaffPermission(c, actor, permission));
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'driver.transfer.cancel', rideId, operationId },
      async (c) => {
        await requireStaffPermission(c, actor, permission);
        const p = await this.context(c, rideId),
          op = await this.operation(c, operationId, p);
        if (op.state === 'canceled') return this.dto(op);
        if (op.first_attempt_at || op.state !== 'queued') throw review();
        await this.reserved(c, p, op);
        await this.journal(c, p, `driver-transfer:${op.id}:cancel`, 'driver_transfer_cancel', [
          { account: 'driver_transfer_pending', owner: p.driverId, amount: op.amount_cents },
          { account: 'driver_payable', owner: p.driverId, amount: -op.amount_cents },
        ]);
        const updated = (
          await c.query<Operation>(
            "UPDATE driver_transfer_operations SET state='canceled',revision=revision+1 WHERE id=$1 RETURNING *",
            [op.id],
          )
        ).rows[0]!;
        await appendAudit(c, actor.id, 'staff.driver_transfer_canceled', op.id, '{}');
        return this.dto(updated);
      },
    );
  }
  private async location(operationId: string) {
    const row = await transaction(this.pool, async (c) => {
      await bindTransferScope(c, this.source, { operationId });
      return (
        await c.query(
          `SELECT p.ride_id FROM driver_transfer_operations o JOIN payment_attempts p ON p.id=o.attempt_id WHERE o.id=$1 AND p.source=$2`,
          [operationId, this.source],
        )
      ).rows[0];
    });
    if (!row) throw review();
    return row.ride_id as string;
  }
  private async apply(
    operationId: string,
    rideId: string,
    revision: number,
    raw: DriverTransferSnapshot,
    actorId?: string,
  ) {
    const result = Snapshot.parse(raw);
    return transaction(this.pool, async (c) => {
      const p = await this.context(c, rideId),
        op = await this.operation(c, operationId, p);
      if (op.revision !== revision) return false;
      await this.reserved(c, p, op);
      if (
        !op.first_attempt_at ||
        op.state === 'canceled' ||
        result.amountCents !== op.amount_cents ||
        result.created * 1000 < op.first_attempt_at.getTime() - 10000 ||
        result.created * 1000 > this.now().getTime() + 10000 ||
        result.reversedCents < op.reversed_cents ||
        result.reversedCents > result.amountCents ||
        (op.provider_transfer_id && op.provider_transfer_id !== result.id)
      )
        throw review();
      const debit = result.movements.filter((m) => m.kind === 'transfer');
      const credits = result.movements.filter((m) => m.kind === 'transfer_refund');
      if (
        debit.length !== 1 ||
        debit[0]!.sourceId !== result.id ||
        debit[0]!.amountCents !== -op.amount_cents ||
        credits.reduce((s, m) => s + m.amountCents, 0) !== result.reversedCents ||
        credits.some((m) => m.amountCents <= 0 || !/^trr_[a-zA-Z0-9]{1,96}$/.test(m.sourceId)) ||
        new Set(result.movements.map((m) => m.id)).size !== result.movements.length ||
        new Set(result.movements.map((m) => m.sourceId)).size !== result.movements.length ||
        result.movements.some((m) => m.netCents !== m.amountCents - m.feeCents)
      )
        throw review();
      const prior = (
        await c.query('SELECT balance_id FROM driver_transfer_movements WHERE operation_id=$1', [op.id])
      ).rows;
      const keys = result.movements.map((m) => m.id);
      if (prior.some((j) => !keys.includes(j.balance_id))) throw review();
      for (const m of result.movements) {
        const reversed = m.kind === 'transfer_refund';
        const journalId = await this.journal(
          c,
          p,
          `driver-transfer-balance:${this.source}:${m.id}`,
          reversed ? 'driver_transfer_reversal' : 'driver_transfer_balance',
          [
            {
              account: reversed ? 'driver_payable' : 'driver_transfer_pending',
              owner: op.driver_id,
              amount: -m.amountCents,
            },
            { account: 'stripe_clearing', owner: null, amount: m.netCents },
            { account: 'processor_fees', owner: null, amount: m.feeCents },
          ],
        );
        await c.query("SELECT set_config('rove.transfer_balance',$1,true)", [m.id]);
        await c.query(
          'INSERT INTO driver_transfer_movements(source,balance_id,operation_id,journal_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [this.source, m.id, op.id, journalId],
        );
        const binding = (
          await c.query(
            'SELECT operation_id,journal_id FROM driver_transfer_movements WHERE source=$1 AND balance_id=$2',
            [this.source, m.id],
          )
        ).rows[0];
        if (binding?.operation_id !== op.id || binding.journal_id !== journalId) throw review();
      }
      await c.query(
        `UPDATE driver_transfer_operations SET provider_transfer_id=$2,state=$3,reversed_cents=$4,checked_at=$5 WHERE id=$1`,
        [
          op.id,
          result.id,
          result.reversedCents ? 'review_required' : 'confirmed',
          result.reversedCents,
          this.now(),
        ],
      );
      if (actorId || !op.provider_transfer_id || op.reversed_cents !== result.reversedCents)
        await appendAudit(
          c,
          actorId ?? null,
          'driver_transfer.verified',
          op.id,
          JSON.stringify({ transferId: result.id, reversedCents: result.reversedCents }),
        );
      return true;
    });
  }
  private async observe(operationId: string, rideId: string, actorId?: string) {
    const prepared = await transaction(this.pool, async (c) => {
      const p = await this.context(c, rideId),
        op = await this.operation(c, operationId, p);
      if (!op.first_attempt_at || op.state === 'canceled') return null;
      await c.query('UPDATE driver_transfer_operations SET revision=revision+1 WHERE id=$1', [op.id]);
      return {
        reference: this.reference(op, p),
        revision: op.revision + 1,
        providerId: op.provider_transfer_id,
      };
    });
    if (!prepared) return false;
    const result = prepared.providerId
      ? await this.provider.retrieve(prepared.reference, prepared.providerId)
      : await this.provider.find(prepared.reference);
    if (!result) return false;
    await this.apply(operationId, rideId, prepared.revision, result, actorId);
    return true;
  }
  async recover(actor: Actor, rawRideId: string, rawId: string) {
    const rideId = z.uuid().parse(rawRideId),
      operationId = z.uuid().parse(rawId);
    await transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, permission);
      const p = await this.context(c, rideId);
      await this.operation(c, operationId, p);
    });
    await this.observe(operationId, rideId, actor.id);
    return transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, permission);
      const p = await this.context(c, rideId);
      return this.dto(await this.operation(c, operationId, p));
    });
  }
  readonly handle: JobHandler = async (job) => {
    const { operationId } = z
      .object({ source: z.literal(this.source), operationId: z.uuid() })
      .strict()
      .parse(job.payload);
    const rideId = await this.location(operationId);
    if (await this.observe(operationId, rideId)) return;
    const initial = await transaction(this.pool, async (c) => {
      const p = await this.context(c, rideId),
        op = await this.operation(c, operationId, p);
      if (op.state !== 'queued' || op.provider_transfer_id) return null;
      if (op.first_attempt_at && op.first_attempt_at.getTime() <= this.now().getTime() - 23 * 3600000) {
        await c.query("UPDATE driver_transfer_operations SET state='review_required' WHERE id=$1", [op.id]);
        return null;
      }
      return p;
    });
    if (!initial) return;
    await this.captureFees.reconcile(initial.intentId);
    await this.refunds.reconcile(initial.intentId);
    await this.disputes.reconcile(initial.intentId);
    const funds = await this.provider.funding(initial);
    const prepared = await transaction(this.pool, async (c) => {
      const p = await this.context(c, rideId),
        op = await this.operation(c, operationId, p);
      if (op.state !== 'queued' || op.provider_transfer_id) return null;
      const eligible = await this.eligible(c, p, op.id);
      const capture = await this.captureFees.assertReady(c, p.attemptId, p.amountCents);
      if (capture.chargeId !== funds.chargeId) throw review();
      await this.reserved(c, p, op);
      if (
        eligible.bindingId !== op.payout_binding_id ||
        eligible.accountId !== op.account_id ||
        funds.unrefundedCents < op.amount_cents ||
        (op.charge_id && op.charge_id !== funds.chargeId)
      )
        throw review();
      if (op.first_attempt_at && op.first_attempt_at.getTime() <= this.now().getTime() - 23 * 3600000) {
        await c.query("UPDATE driver_transfer_operations SET state='review_required' WHERE id=$1", [op.id]);
        return null;
      }
      const updated = (
        await c.query<Operation>(
          'UPDATE driver_transfer_operations SET first_attempt_at=COALESCE(first_attempt_at,$2),charge_id=COALESCE(charge_id,$3),revision=revision+1 WHERE id=$1 RETURNING *',
          [op.id, this.now(), funds.chargeId],
        )
      ).rows[0]!;
      return { reference: this.reference(updated, p), revision: updated.revision };
    });
    if (!prepared) return;
    const result = await this.provider.create(prepared.reference);
    await this.apply(operationId, rideId, prepared.revision, result);
  };
  /** Fair bounded recovery, including confirmed transfers whose funds can later be reversed. */
  async sweep() {
    return transaction(this.pool, async (c) => {
      await bindTransferScope(c, this.source, { sweep: true });
      const rows = (
        await c.query(
          `SELECT o.id FROM driver_transfer_operations o JOIN payment_attempts p ON p.id=o.attempt_id
        WHERE p.source=$1 AND o.state<>'canceled' AND (o.requested_at IS NULL OR o.requested_at<$2::timestamptz-interval '1 hour')
        ORDER BY o.requested_at NULLS FIRST,o.created_at,o.id LIMIT 100 FOR UPDATE OF o SKIP LOCKED`,
          [this.source, this.now()],
        )
      ).rows;
      for (const o of rows) {
        await bindTransferScope(c, this.source, { operationId: o.id, writable: true });
        await c.query('UPDATE driver_transfer_operations SET requested_at=$2 WHERE id=$1', [
          o.id,
          this.now(),
        ]);
        await enqueueOutbox(c, {
          topic: 'transfer.execute',
          aggregateId: o.id,
          payload: JSON.stringify({ source: this.source, operationId: o.id }),
          dedupeKey: `transfer-sweep:${o.id}:${randomUUID()}`,
        });
      }
      return rows.length;
    });
  }
}
