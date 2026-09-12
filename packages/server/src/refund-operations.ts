import { z } from 'zod';
import { RefundAuthorization, RefundOperation } from '@rove/contracts';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from './rides';
import type { PaymentProvider, PaymentReference } from './payment-provider';
import type { DisputeReconciler } from './disputes';
import type { RefundReconciler } from './refund-reconciliation';
import type { JobHandler } from './outbox';
import { command, transaction } from './transactions';
import { requireStaffPermission } from './staff-access';
import { DomainError } from './errors';
const unavailable = () =>
  new DomainError('REFUND_REVIEW_REQUIRED', 'Verify the payment and refund history before proceeding.', 409);
const permission = 'payments.refund';
const active = new Set(['pending', 'requires_action', 'succeeded']);
interface Operation {
  id: string;
  attempt_id: string;
  amount_cents: number;
  state: string;
  first_attempt_at: Date | null;
  provider_refund_id: string | null;
  created_at: Date;
}
/** Staff authorization is durable before provider mutation. This never selects a loss-allocation policy. */
export class RefundOperations {
  constructor(
    private pool: Pool,
    private provider: Pick<PaymentProvider, 'refund'>,
    private reconciliation: RefundReconciler,
    private source: string,
    private now: () => Date = () => new Date(),
    private disputes?: DisputeReconciler,
  ) {}
  private async reference(client: PoolClient, rideId: string): Promise<PaymentReference> {
    const row = (
      await client.query(
        `SELECT p.*,c.customer_id FROM payment_attempts p
    JOIN payment_customers c ON c.id=p.customer_binding_id AND c.source=p.source
    JOIN rides r ON r.id=p.ride_id AND r.rider_id=c.rider_id AND r.fare_cents=p.amount_cents
    WHERE p.ride_id=$1 AND p.source=$2 AND p.intent_id IS NOT NULL FOR UPDATE OF p`,
        [rideId, this.source],
      )
    ).rows[0];
    if (!row) throw unavailable();
    return {
      attemptId: row.id,
      rideId,
      intentId: row.intent_id,
      customerId: row.customer_id,
      amountCents: row.amount_cents,
    };
  }
  private async available(client: PoolClient, reference: PaymentReference, exclude?: string) {
    await this.disputes?.assertRefundable(client, reference.attemptId);
    if (
      (
        await client.query(
          "SELECT id FROM driver_transfer_operations WHERE attempt_id=$1 AND state IN ('queued','review_required')",
          [reference.attemptId],
        )
      ).rowCount
    )
      throw unavailable();
    const check = (
      await client.query('SELECT * FROM payment_refund_checks WHERE attempt_id=$1 FOR SHARE', [
        reference.attemptId,
      ])
    ).rows[0];
    if (
      !check?.verified_at ||
      check.verified_at.getTime() < this.now().getTime() - 300000 ||
      check.verified_at.getTime() > this.now().getTime() + 10000
    )
      throw unavailable();
    const captures = (
      await client.query(
        `SELECT sum(p.amount_cents)::int AS amount,count(*)::int AS count FROM ledger_journals j
    JOIN ledger_postings p ON p.journal_id=j.id AND p.account='stripe_clearing' WHERE j.attempt_id=$1 AND j.kind='capture'`,
        [reference.attemptId],
      )
    ).rows[0];
    if (captures.count !== 1 || captures.amount !== check.received_cents || captures.amount <= 0)
      throw unavailable();
    const history = z
      .array(
        z.object({
          id: z.string(),
          amountCents: z.number().int().positive(),
          status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
        }),
      )
      .parse(check.refunds);
    let reserved = history.filter((r) => active.has(r.status)).reduce((s, r) => s + r.amountCents, 0);
    const operations = (
      await client.query<Operation>('SELECT * FROM refund_operations WHERE attempt_id=$1', [
        reference.attemptId,
      ])
    ).rows;
    for (const op of operations) {
      if (op.id === exclude) continue;
      if (!op.provider_refund_id) {
        // Uncertain operations must recover before another staff decision can create money movement.
        throw unavailable();
      }
      const observed = history.find((r) => r.id === op.provider_refund_id);
      if (!observed || observed.amountCents !== op.amount_cents) throw unavailable();
    }
    reserved = Math.max(0, reserved);
    return captures.amount - reserved;
  }
  async authorize(actor: Actor, rawRideId: string, raw: unknown, key: string) {
    const rideId = z.uuid().parse(rawRideId),
      input = RefundAuthorization.parse(raw);
    await transaction(this.pool, (c) => requireStaffPermission(c, actor, permission));
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'refund.authorize', rideId, ...input },
      async (client) => {
        await requireStaffPermission(client, actor, permission);
        const reference = await this.reference(client, rideId);
        if (input.amountCents > (await this.available(client, reference)))
          throw new DomainError('REFUND_LIMIT', 'Refund exceeds the verified remaining payment.', 409);
        const op = (
          await client.query<Operation>(
            `INSERT INTO refund_operations(attempt_id,authorized_by,amount_cents,reason,policy_reference) VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [reference.attemptId, actor.id, input.amountCents, input.reason, input.policyReference],
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES('refund.execute',$1,$2,$3)`,
          [op.id, JSON.stringify({ source: this.source, operationId: op.id }), `refund-execute:${op.id}`],
        );
        await client.query(
          `INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'staff.refund_authorized',$2,$3)`,
          [actor.id, op.id, JSON.stringify({ rideId, amountCents: input.amountCents, reason: input.reason })],
        );
        return this.dto(op);
      },
    );
  }
  private dto(op: Operation) {
    return RefundOperation.parse({
      id: op.id,
      state: op.state,
      amountCents: op.amount_cents,
      createdAt: op.created_at.toISOString(),
    });
  }
  async list(actor: Actor, rawRideId: string) {
    const rideId = z.uuid().parse(rawRideId);
    return transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, permission);
      const reference = await this.reference(client, rideId);
      const result = await client.query<Operation>(
        'SELECT * FROM refund_operations WHERE attempt_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
        [reference.attemptId],
      );
      return { operations: result.rows.map((op) => this.dto(op)) };
    });
  }
  /** Read-only provider verification can resolve an uncertain submission even beyond the mutation retry window. */
  private async recoverKnown(operationId: string, rideId: string, actorId?: string): Promise<boolean> {
    const reference = await transaction(this.pool, (c) => this.reference(c, rideId));
    await this.reconciliation.reconcile(reference.intentId);
    return transaction(this.pool, async (client) => {
      await this.reference(client, rideId);
      const op = (
        await client.query<Operation>(
          'SELECT * FROM refund_operations WHERE id=$1 AND attempt_id=$2 FOR UPDATE',
          [operationId, reference.attemptId],
        )
      ).rows[0];
      if (!op) throw unavailable();
      if (op.provider_refund_id) return true;
      if (!op.first_attempt_at) return false;
      const check = (
        await client.query('SELECT * FROM payment_refund_checks WHERE attempt_id=$1 FOR SHARE', [
          reference.attemptId,
        ])
      ).rows[0];
      if (!check?.verified_at || check.verified_at.getTime() < this.now().getTime() - 300000)
        throw unavailable();
      const history = z
        .array(
          z.object({
            id: z.string().regex(/^re_[a-zA-Z0-9]{1,96}$/),
            operationId: z.uuid().optional(),
            amountCents: z.number().int().positive(),
            created: z.number().int(),
          }),
        )
        .parse(check.refunds);
      const matches = history.filter((r) => r.operationId === op.id);
      if (!matches.length) return false;
      if (
        matches.length !== 1 ||
        matches[0]!.amountCents !== op.amount_cents ||
        matches[0]!.created * 1000 < op.first_attempt_at.getTime() - 120000 ||
        matches[0]!.created * 1000 > this.now().getTime() + 120000
      )
        throw unavailable();
      await client.query("UPDATE refund_operations SET state='submitted',provider_refund_id=$2 WHERE id=$1", [
        op.id,
        matches[0]!.id,
      ]);
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'refund.submission_recovered',$2,'{}')",
        [actorId ?? null, op.id],
      );
      return true;
    });
  }
  async recover(actor: Actor, rawRideId: string, rawOperationId: string) {
    const rideId = z.uuid().parse(rawRideId),
      operationId = z.uuid().parse(rawOperationId);
    await transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, permission);
      const reference = await this.reference(client, rideId);
      if (
        !(
          await client.query('SELECT id FROM refund_operations WHERE id=$1 AND attempt_id=$2', [
            operationId,
            reference.attemptId,
          ])
        ).rowCount
      )
        throw unavailable();
    });
    await this.recoverKnown(operationId, rideId, actor.id);
    return transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, permission);
      const op = (await client.query<Operation>('SELECT * FROM refund_operations WHERE id=$1', [operationId]))
        .rows[0]!;
      return this.dto(op);
    });
  }
  readonly handle: JobHandler = async (job) => {
    const input = z
      .object({ source: z.literal(this.source), operationId: z.uuid() })
      .strict()
      .parse(job.payload);
    const initial = (
      await this.pool.query(
        `SELECT o.*,p.ride_id,p.intent_id,p.source FROM refund_operations o JOIN payment_attempts p ON p.id=o.attempt_id WHERE o.id=$1 AND p.source=$2`,
        [input.operationId, this.source],
      )
    ).rows[0];
    if (!initial) throw unavailable();
    if (
      initial.first_attempt_at &&
      !initial.provider_refund_id &&
      (await this.recoverKnown(initial.id, initial.ride_id))
    )
      return;
    if (initial.state === 'review_required') return;
    if (initial.provider_refund_id) {
      await this.reconciliation.reconcile(initial.intent_id);
      return;
    }
    // Retry is bounded by the first persisted attempt, not by the age of the most recent job.
    const prepared = await transaction(this.pool, async (client) => {
      const reference = await this.reference(client, initial.ride_id);
      const op = (
        await client.query<Operation>('SELECT * FROM refund_operations WHERE id=$1 FOR UPDATE', [initial.id])
      ).rows[0]!;
      if (op.provider_refund_id || op.state === 'review_required') return null;
      if (op.first_attempt_at && op.first_attempt_at.getTime() <= this.now().getTime() - 23 * 3600000) {
        await client.query("UPDATE refund_operations SET state='review_required' WHERE id=$1", [op.id]);
        await client.query(
          "INSERT INTO audit(action,aggregate_id,metadata) VALUES('refund.review_required',$1,'{}')",
          [op.id],
        );
        return null;
      }
      return { reference, op };
    });
    if (!prepared) return;
    // Refresh authoritative history before the first attempt. A lost-response retry must replay its original key even if that refund is already visible.
    if (!prepared.op.first_attempt_at) {
      await this.reconciliation.reconcile(prepared.reference.intentId);
    }
    await this.disputes?.reconcile(prepared.reference.intentId);
    const ready = await transaction(this.pool, async (client) => {
      const reference = await this.reference(client, initial.ride_id);
      const op = (
        await client.query<Operation>('SELECT * FROM refund_operations WHERE id=$1 FOR UPDATE', [initial.id])
      ).rows[0]!;
      if (op.state !== 'queued') return null;
      await this.disputes?.assertRefundable(client, reference.attemptId);
      if (!op.first_attempt_at) {
        if (op.amount_cents > (await this.available(client, reference, op.id))) throw unavailable();
        await client.query('UPDATE refund_operations SET first_attempt_at=$2 WHERE id=$1', [
          op.id,
          this.now(),
        ]);
      } else if (op.first_attempt_at.getTime() <= this.now().getTime() - 23 * 3600000) {
        await client.query("UPDATE refund_operations SET state='review_required' WHERE id=$1", [op.id]);
        return null;
      }
      return { reference, op };
    });
    if (!ready) return;
    const result = await this.provider.refund(
      ready.reference,
      ready.op.amount_cents,
      `rove-refund:${ready.op.id}`,
    );
    if (!/^re_[a-zA-Z0-9]{1,96}$/.test(result.id) || result.amountCents !== ready.op.amount_cents)
      throw unavailable();
    await transaction(this.pool, async (client) => {
      const current = (
        await client.query<Operation>('SELECT * FROM refund_operations WHERE id=$1 FOR UPDATE', [initial.id])
      ).rows[0]!;
      if (current.provider_refund_id && current.provider_refund_id !== result.id) throw unavailable();
      await client.query("UPDATE refund_operations SET state='submitted',provider_refund_id=$2 WHERE id=$1", [
        initial.id,
        result.id,
      ]);
      await client.query(
        `INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES('refund.reconcile',$1,$2,$3) ON CONFLICT DO NOTHING`,
        [
          initial.id,
          JSON.stringify({ source: this.source, intentId: ready.reference.intentId }),
          `refund-submitted:${initial.id}`,
        ],
      );
    });
  };
}
