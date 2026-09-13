import { z } from 'zod';
import type { Pool } from 'pg';
import { PaymentReviewCase, PaymentReviewQueue, PaymentReviewAcknowledgment } from '@rove/contracts';
import { outboxTransaction } from './outbox-scope';
import { bindPaymentAttemptRead } from './payment-attempt-scope';
import { requireStaffPermission } from './staff-access';
import { transaction } from './transactions';
import { appendAudit } from './audit';
import { DomainError } from './errors';
import type { Actor } from './rides';
import type { Job, JobHandler } from './outbox';

function dto(row: Record<string, unknown>) {
  return PaymentReviewCase.parse({
    id: row.id,
    rideId: row.ride_id,
    createdAt: (row.created_at as Date).toISOString(),
    acknowledgedAt: row.acknowledged_at ? (row.acknowledged_at as Date).toISOString() : null,
    reference: row.reference,
  });
}
/** Durable escalation evidence. Acknowledgment never changes funding or authorizes money movement. */
export class PaymentReviews {
  constructor(
    private pool: Pool,
    private source: string,
  ) {
    z.string()
      .regex(/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/)
      .parse(source);
  }
  readonly handle: JobHandler = async (job) => this.intake(job);
  private async intake(job: Job, actor?: Actor) {
    const input = z.object({ attemptId: z.uuid() }).strict().parse(job.payload);
    if (job.topic !== 'payment.review_required')
      throw new DomainError('PAYMENT_REVIEW_EVENT', 'Invalid review event.', 422);
    await outboxTransaction(this.pool, { kind: 'notification', id: job.id }, async (c) => {
      if (actor) {
        await requireStaffPermission(c, actor, 'payments.review');
        await c.query("SELECT set_config('rove.outbox_work',$1,true)", [
          JSON.stringify({ kind: 'notification', id: job.id }),
        ]);
      }
      const event = (await c.query('SELECT topic,aggregate_id,payload FROM outbox WHERE id=$1', [job.id]))
        .rows[0];
      if (
        !event ||
        event.topic !== job.topic ||
        event.aggregate_id !== job.aggregateId ||
        event.payload.attemptId !== input.attemptId
      )
        throw new DomainError('PAYMENT_REVIEW_EVENT', 'Review event does not match persisted evidence.', 422);
      await bindPaymentAttemptRead(c, this.source, { attemptId: input.attemptId });
      const attempt = (
        await c.query('SELECT ride_id FROM payment_attempts WHERE id=$1 AND source=$2', [
          input.attemptId,
          this.source,
        ])
      ).rows[0];
      if (attempt?.ride_id !== job.aggregateId)
        throw new DomainError('PAYMENT_REVIEW_EVENT', 'Payment review source does not match.', 422);
      await c.query("SELECT set_config('rove.payment_review_intake',$1,true)", [
        JSON.stringify({
          id: job.id,
          rideId: job.aggregateId,
          attemptId: input.attemptId,
          source: this.source,
        }),
      ]);
      const prior = (
        await c.query('SELECT ride_id,attempt_id,source FROM payment_review_cases WHERE id=$1', [job.id])
      ).rows[0];
      if (prior) {
        if (
          prior.ride_id !== job.aggregateId ||
          prior.attempt_id !== input.attemptId ||
          prior.source !== this.source
        )
          throw new DomainError('PAYMENT_REVIEW_EVENT', 'Conflicting review evidence.', 409);
        return;
      }
      const inserted = await c.query(
        'INSERT INTO payment_review_cases(id,ride_id,attempt_id,source) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id',
        [job.id, job.aggregateId, input.attemptId, this.source],
      );
      if (inserted.rowCount)
        await appendAudit(
          c,
          actor?.id ?? null,
          actor ? 'payment.review_recovered' : 'payment.review_opened',
          job.id,
          JSON.stringify({ rideId: job.aggregateId }),
        );
    });
  }
  async recover(actor: Actor, eventId: string) {
    z.uuid().parse(eventId);
    const job = await outboxTransaction(this.pool, { kind: 'notification', id: eventId }, async (c) => {
      await requireStaffPermission(c, actor, 'payments.review');
      await c.query("SELECT set_config('rove.outbox_work',$1,true)", [
        JSON.stringify({ kind: 'notification', id: eventId }),
      ]);
      const row = (
        await c.query(
          "SELECT * FROM outbox WHERE id=$1 AND topic='payment.review_required' AND dead_letter_at IS NOT NULL",
          [eventId],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Dead-lettered payment review not found.', 404);
      return {
        id: row.id,
        topic: row.topic,
        aggregateId: row.aggregate_id,
        payload: row.payload,
        attempt: row.attempts,
      } satisfies Job;
    });
    await this.intake(job, actor);
    return { id: eventId };
  }
  async queue(actor: Actor, raw: unknown) {
    const input = z
      .object({ after: z.uuid().optional(), includeAcknowledged: z.enum(['true', 'false']).optional() })
      .strict()
      .parse(raw);
    return transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, 'payments.review');
      const rows = (
        await c.query(
          'SELECT * FROM payment_review_cases WHERE source=$1 AND ($2::uuid IS NULL OR id>$2::uuid) AND ($3::boolean OR acknowledged_at IS NULL) ORDER BY id LIMIT 51',
          [this.source, input.after ?? null, input.includeAcknowledged === 'true'],
        )
      ).rows;
      const items = rows.slice(0, 50).map(dto);
      return PaymentReviewQueue.parse({ items, nextCursor: rows.length > 50 ? items.at(-1)!.id : null });
    });
  }
  async acknowledge(actor: Actor, id: string, raw: unknown) {
    z.uuid().parse(id);
    const input = PaymentReviewAcknowledgment.parse(raw);
    return transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, 'payments.review');
      const row = (
        await c.query('SELECT * FROM payment_review_cases WHERE id=$1 AND source=$2 FOR UPDATE', [
          id,
          this.source,
        ])
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Payment review not found.', 404);
      if (row.acknowledged_at) {
        if (row.reference !== input.reference)
          throw new DomainError('REVIEW_ACKNOWLEDGED', 'This review already has an acknowledgment.', 409);
        return dto(row);
      }
      await c.query(
        "SELECT set_config('rove.payment_review_ack',(to_jsonb(p)||jsonb_build_object('acknowledged_at',now(),'acknowledged_by',$2::uuid,'reference',$3::text))::text,true) FROM payment_review_cases p WHERE id=$1",
        [id, actor.id, input.reference],
      );
      const updated = (
        await c.query(
          'UPDATE payment_review_cases SET acknowledged_at=now(),acknowledged_by=$2,reference=$3 WHERE id=$1 RETURNING *',
          [id, actor.id, input.reference],
        )
      ).rows[0];
      await appendAudit(
        c,
        actor.id,
        'payment.review_acknowledged',
        id,
        JSON.stringify({ reference: input.reference }),
      );
      return dto(updated);
    });
  }
}
