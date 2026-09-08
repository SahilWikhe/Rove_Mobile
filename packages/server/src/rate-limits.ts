import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { DomainError } from './errors';

export const requestLimits = {
  read: 1200,
  mutation: 120,
  places: 30,
  quotes: 10,
  paymentSessions: 10,
  signup: 5,
  support: 5,
  trackingGrant: 6,
  heartbeat: 60,
  backgroundLocation: 60,
} as const;
export type RequestLimit = keyof typeof requestLimits;
export class RateLimitError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 'Too many requests. Please wait and try again.', 429);
  }
}
/** Fixed 60-second windows using the database clock and atomic shared counters. */
export class RequestLimiter {
  constructor(private pool: Pool) {}
  async consume(subject: string, policy: RequestLimit): Promise<void> {
    if (!subject || subject.length > 1000 || !Object.hasOwn(requestLimits, policy))
      throw new DomainError('INVALID_LIMIT_IDENTITY', 'Unable to process this request.', 503);
    const key = createHash('sha256')
      .update(JSON.stringify([policy, subject]))
      .digest('hex');
    let result;
    try {
      result = await this.pool.query<{ count: number; retry_after: number }>(
        `INSERT INTO rate_limit_buckets(key,count,expires_at)
         VALUES ($1,1,statement_timestamp()+interval '60 seconds')
         ON CONFLICT(key) DO UPDATE SET
           count=CASE WHEN rate_limit_buckets.expires_at <= statement_timestamp() THEN 1
             ELSE LEAST(rate_limit_buckets.count+1,$2+1) END,
           expires_at=CASE WHEN rate_limit_buckets.expires_at <= statement_timestamp()
             THEN statement_timestamp()+interval '60 seconds' ELSE rate_limit_buckets.expires_at END
         RETURNING count, GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-statement_timestamp())))::int AS retry_after`,
        [key, requestLimits[policy]],
      );
    } catch {
      // Do not turn a database outage into unrestricted billable provider calls.
      throw new DomainError('RATE_LIMIT_UNAVAILABLE', 'Please try again shortly.', 503);
    }
    const row = result.rows[0];
    if (!row) throw new DomainError('RATE_LIMIT_UNAVAILABLE', 'Please try again shortly.', 503);
    if (row.count > requestLimits[policy]) throw new RateLimitError(row.retry_after);
  }
  /** Maintenance only: bounded batches, safe alongside active traffic and other cleaners. */
  async prune(): Promise<number> {
    const result = await this.pool.query(`DELETE FROM rate_limit_buckets WHERE key IN (
      SELECT key FROM rate_limit_buckets WHERE expires_at < statement_timestamp()-interval '1 day'
      ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    )`);
    return result.rowCount ?? 0;
  }
}
