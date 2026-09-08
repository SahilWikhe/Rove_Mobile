import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DomainError } from './errors';
export interface Job { id: string; topic: string; aggregateId: string; payload: unknown; attempt: number }
export type JobHandler = (job: Job) => Promise<void>;
interface ClaimedRow { id: string; topic: string; aggregate_id: string; payload: unknown; attempts: number }
/** Persistent leases plus fenced acknowledgements; handlers must also be idempotent. */
export class OutboxWorker {
  constructor(private pool: Pool, private handlers: Record<string, JobHandler>, private now: () => Date = () => new Date(), private random: () => number = Math.random) {}
  async runOnce(maxJobs = 10): Promise<{ processed: number; failed: number }> {
    let processed = 0; let failed = 0;
    for (let index = 0; index < Math.min(Math.max(maxJobs, 1), 50); index++) {
      const token = randomUUID();
      const row = (await this.pool.query<ClaimedRow>(`UPDATE outbox SET lease_token=$1,locked_until=$2::timestamptz+interval '60 seconds',attempts=attempts+1
        WHERE id=(SELECT id FROM outbox WHERE completed_at IS NULL AND dead_letter_at IS NULL AND available_at<=$2
          AND (locked_until IS NULL OR locked_until<=$2) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [token, this.now()])).rows[0];
      if (!row) break;
      try {
        const handler = this.handlers[row.topic];
        if (!handler) throw new DomainError('UNKNOWN_JOB_TYPE', 'No handler is registered for this event.', 422);
        await handler({ id: row.id, topic: row.topic, aggregateId: row.aggregate_id, payload: row.payload, attempt: row.attempts });
        await this.pool.query('UPDATE outbox SET completed_at=$3,locked_until=NULL,lease_token=NULL,last_error_code=NULL WHERE id=$1 AND lease_token=$2', [row.id, token, this.now()]);
        processed++;
      } catch (error) {
        failed++;
        const code = error instanceof DomainError ? error.code : 'WORKER_ERROR';
        const permanent = row.attempts >= 12 || code === 'UNKNOWN_JOB_TYPE';
        const retryMs = Math.min(300_000, 1000 * 2 ** Math.min(row.attempts, 8)) * (0.8 + 0.4 * this.random());
        await this.pool.query('UPDATE outbox SET locked_until=NULL,lease_token=NULL,last_error_code=$3,available_at=$4,dead_letter_at=$5 WHERE id=$1 AND lease_token=$2',
          [row.id, token, code, new Date(this.now().getTime() + retryMs), permanent ? this.now() : null]);
      }
    }
    return { processed, failed };
  }
}
