import { enqueueOutbox } from './outbox-enqueue';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { DomainError } from './errors';
import { transaction } from './transactions';
import { PushAudience } from './push-audience';
import type { PushProvider, PushReceipt, PushTicket } from './push-provider';
import type { Job, JobHandler } from './outbox';

type Delivery = {
  id: string;
  event_id: string;
  installation_id: string;
  revision: number;
  state: string;
  receipt_id: string | null;
  accepted_at: Date | null;
  locked_until: Date | null;
  receipt_attempts: number;
};
const topics = [
  'payment.updated',
  'message.created',
  'offer.created',
  'ride.matched',
  'ride.en_route',
  'ride.arrived',
  'ride.in_progress',
  'ride.completed',
  'ride.cancelled',
  'ride.no_driver_found',
  'ride.no_show',
  'ride.interrupted',
  'ride.terminated',
];
const problem = (code: string) => new DomainError(code, 'Notification delivery needs another attempt.', 503);

export class PushDelivery {
  private audience: PushAudience;
  constructor(
    private pool: Pool,
    private provider: PushProvider,
    projects: Partial<Record<'rider' | 'driver', string>>,
    private now: () => Date = () => new Date(),
  ) {
    this.audience = new PushAudience(pool, projects, now);
  }
  /** Existing financial handlers retain responsibility for their work. Fan-out is separately idempotent. */
  handlers(existing: Record<string, JobHandler>): Record<string, JobHandler> {
    const combined = { ...existing };
    for (const topic of topics) {
      const previous = existing[topic];
      combined[topic] = async (job) => {
        if (previous) await previous(job);
        await this.fanout(job);
      };
    }
    combined['push.send'] = this.send;
    combined['push.receipt'] = this.receipt;
    return combined;
  }
  readonly fanout: JobHandler = async (job) => {
    const recipients = await this.audience.recipients(job.id);
    await transaction(this.pool, async (client) => {
      for (const recipient of recipients) {
        await bindPushDelivery(client, { recipient });
        const inserted = (
          await client.query<{ id: string }>(
            `INSERT INTO push_deliveries(event_id,installation_id,revision) VALUES($1,$2,$3)
           ON CONFLICT(event_id,installation_id,revision) DO NOTHING RETURNING id`,
            [recipient.eventId, recipient.installationId, recipient.revision],
          )
        ).rows[0];
        const row =
          inserted ??
          (
            await client.query<{ id: string }>(
              'SELECT id FROM push_deliveries WHERE event_id=$1 AND installation_id=$2 AND revision=$3',
              [recipient.eventId, recipient.installationId, recipient.revision],
            )
          ).rows[0];
        if (!row) throw problem('PUSH_DELIVERY_UNAVAILABLE');
        await this.enqueue(client, 'push.send', row.id, `push-send:${row.id}`, this.now());
      }
    });
  };
  private async enqueue(
    client: PoolClient,
    topic: string,
    id: string,
    key: string,
    at: Date,
    attempt?: number,
  ) {
    await enqueueOutbox(client, {
      topic: topic,
      aggregateId: id,
      payload: JSON.stringify(attempt === undefined ? {} : { attempt }),
      dedupeKey: key,
      availableAt: at,
      ignoreDuplicate: true,
    });
  }
  private async claim(job: Job, receipt: boolean) {
    z.uuid().parse(job.aggregateId);
    const attempt = receipt
      ? z.object({ attempt: z.number().int().nonnegative() }).strict().parse(job.payload).attempt
      : undefined;
    if (!receipt) z.object({}).strict().parse(job.payload);
    return transaction(this.pool, async (client) => {
      await bindPushDelivery(client, { delivery: job.aggregateId });
      const row = (
        await client.query<Delivery>('SELECT * FROM push_deliveries WHERE id=$1 FOR UPDATE', [
          job.aggregateId,
        ])
      ).rows[0];
      if (!row || !(receipt ? row.state === 'receipt' : ['pending', 'sending'].includes(row.state)))
        return null;
      if (receipt && row.receipt_attempts !== attempt) return null;
      if (row.locked_until && row.locked_until > this.now()) throw problem('PUSH_DELIVERY_BUSY');
      const lease = randomUUID();
      await client.query(
        `UPDATE push_deliveries SET lease_token=$2,locked_until=$3::timestamptz+interval '60 seconds',
        state=$4,attempts=attempts+$5,updated_at=$3 WHERE id=$1`,
        [row.id, lease, this.now(), receipt ? 'receipt' : 'sending', receipt ? 0 : 1],
      );
      return { row, lease };
    });
  }
  private async finish(
    row: Delivery,
    lease: string,
    state: string,
    error: string | null,
    receiptId?: string,
    nextReceipt = false,
  ) {
    return transaction(this.pool, async (client) => {
      await bindPushDelivery(client, { delivery: row.id });
      const result = await client.query(
        `UPDATE push_deliveries SET state=$3,last_error=$4,lease_token=NULL,
        locked_until=NULL,updated_at=$5,receipt_id=COALESCE($6,receipt_id),
        accepted_at=CASE WHEN $6::uuid IS NOT NULL THEN $5 ELSE accepted_at END,
        receipt_attempts=receipt_attempts+$7 WHERE id=$1 AND lease_token=$2 RETURNING id`,
        [row.id, lease, state, error, this.now(), receiptId ?? null, nextReceipt ? 1 : 0],
      );
      if (!result.rowCount) throw problem('PUSH_DELIVERY_LEASE_CHANGED');
      if (state === 'invalid_token') {
        await client.query(
          "SELECT set_config('rove.install_target',$1,true),set_config('rove.install_revision',$2,true)",
          [row.installation_id, String(row.revision)],
        );
        await client.query(
          `UPDATE push_installations SET enabled=false,revision=revision+1,mutation_id=NULL,
          mutation_hash=NULL,updated_at=$3 WHERE id=$1 AND revision=$2 AND enabled=true`,
          [row.installation_id, row.revision, this.now()],
        );
      }
      if (state === 'receipt') {
        const attempt = row.receipt_attempts + (nextReceipt ? 1 : 0);
        await this.enqueue(
          client,
          'push.receipt',
          row.id,
          `push-receipt:${row.id}:${attempt}`,
          new Date(this.now().getTime() + 15 * 60_000),
          attempt,
        );
      }
    });
  }
  async sweep(): Promise<number> {
    return transaction(this.pool, async (client) => {
      await bindPushDelivery(client, { recoverAt: this.now() });
      const rows = (
        await client.query<Delivery>(
          `SELECT * FROM push_deliveries
        WHERE state IN ('pending','sending','receipt') AND updated_at<$1::timestamptz-interval '20 minutes'
        AND (locked_until IS NULL OR locked_until<=$1) ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 100`,
          [this.now()],
        )
      ).rows;
      for (const row of rows) {
        const receipt = row.state === 'receipt';
        await this.enqueue(
          client,
          receipt ? 'push.receipt' : 'push.send',
          row.id,
          `push-recovery:${row.id}:${Math.floor(this.now().getTime() / 1200000)}`,
          this.now(),
          receipt ? row.receipt_attempts : undefined,
        );
      }
      return rows.length;
    });
  }
  /** Atomic shared rate window caps this deployment at 100 sends/sec/project across hosts. */
  private async capacity(installationId: string) {
    const result = await transaction(this.pool, async (client) => {
      await client.query(
        "SELECT set_config('rove.install_target',$1,true),set_config('rove.install_revision','',true)",
        [installationId],
      );
      await client.query(
        "SELECT set_config('rove.push_rate_project',COALESCE((SELECT project_id::text FROM push_installations WHERE id=$1),''),true)",
        [installationId],
      );
      return client.query(
        `INSERT INTO push_rate_windows(project_id,window_at,count)
      SELECT project_id,date_trunc('second',$2::timestamptz),1 FROM push_installations WHERE id=$1
      ON CONFLICT(project_id) DO UPDATE SET window_at=EXCLUDED.window_at,
      count=CASE WHEN push_rate_windows.window_at<EXCLUDED.window_at THEN 1 ELSE push_rate_windows.count+1 END
      WHERE push_rate_windows.window_at<EXCLUDED.window_at OR
        (push_rate_windows.window_at=EXCLUDED.window_at AND push_rate_windows.count<100) RETURNING project_id`,
        [installationId, this.now()],
      );
    });
    return !!result.rowCount;
  }
  readonly send: JobHandler = async (job) => {
    const claim = await this.claim(job, false);
    if (!claim) return;
    const { row, lease } = claim;
    let ticket: PushTicket;
    try {
      if (!(await this.capacity(row.installation_id))) throw problem('PUSH_RATE_LIMITED');
      const message = await this.audience.message({
        eventId: row.event_id,
        installationId: row.installation_id,
        revision: row.revision,
      });
      if (!message) {
        await this.finish(row, lease, 'suppressed', null);
        return;
      }
      ticket = await this.provider.send(message);
    } catch (error) {
      // Lost responses may represent accepted sends. Retries are bounded by event TTL;
      // exactly-once delivery is impossible without provider idempotency support.
      await this.finish(
        row,
        lease,
        'pending',
        error instanceof DomainError ? error.code : 'PUSH_SEND_UNCONFIRMED',
      );
      throw problem('PUSH_SEND_RETRY');
    }
    if (ticket.status === 'accepted') {
      z.uuid().parse(ticket.receiptId);
      await this.finish(row, lease, 'receipt', null, ticket.receiptId);
    } else if (ticket.status === 'retryable') {
      await this.finish(row, lease, 'pending', 'PUSH_PROVIDER_UNAVAILABLE');
      throw problem('PUSH_SEND_RETRY');
    } else {
      await this.finish(
        row,
        lease,
        ticket.status === 'expired' ? 'suppressed' : ticket.status,
        ticket.status === 'expired' ? null : `PUSH_${ticket.status.toUpperCase()}`,
      );
    }
  };
  readonly receipt: JobHandler = async (job) => {
    const claim = await this.claim(job, true);
    if (!claim) return;
    const { row, lease } = claim;
    if (!row.receipt_id || !row.accepted_at) throw problem('PUSH_RECEIPT_REFERENCE_MISSING');
    if (this.now().getTime() >= row.accepted_at.getTime() + 23 * 60 * 60_000) {
      await this.finish(row, lease, 'receipt_expired', 'PUSH_RECEIPT_UNCONFIRMED');
      return;
    }
    let receipt: PushReceipt;
    try {
      receipt = await this.provider.receipt(row.receipt_id);
    } catch {
      receipt = { status: 'retryable' };
    }
    if (receipt.status === 'pending' || receipt.status === 'retryable') {
      await this.finish(row, lease, 'receipt', 'PUSH_RECEIPT_UNCONFIRMED', undefined, true);
    } else {
      await this.finish(
        row,
        lease,
        receipt.status,
        receipt.status === 'accepted_by_gateway' ? null : `PUSH_${receipt.status.toUpperCase()}`,
      );
    }
  };
}

/** Backend-only scope derived from a verified audience or durable delivery job. */
async function bindPushDelivery(
  client: PoolClient,
  scope: {
    recipient?: { eventId: string; installationId: string; revision: number };
    delivery?: string;
    recoverAt?: Date;
  },
) {
  const parsed = z
    .object({
      recipient: z
        .object({ eventId: z.uuid(), installationId: z.uuid(), revision: z.number().int().positive() })
        .optional(),
      delivery: z.uuid().optional(),
      recoverAt: z.date().optional(),
    })
    .parse(scope);
  await client.query(
    "SELECT set_config('rove.push_event',$1,true),set_config('rove.push_installation',$2,true),set_config('rove.push_revision',$3,true),set_config('rove.push_delivery',$4,true),set_config('rove.push_recovery_at',$5,true)",
    [
      parsed.recipient?.eventId ?? '',
      parsed.recipient?.installationId ?? '',
      parsed.recipient?.revision.toString() ?? '',
      parsed.delivery ?? '',
      parsed.recoverAt?.toISOString() ?? '',
    ],
  );
}
