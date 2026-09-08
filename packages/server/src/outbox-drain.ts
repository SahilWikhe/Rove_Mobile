import type { Pool } from 'pg';
import type { OutboxWorker } from './outbox';

/** Bounded function invocation; database leases, not process memory, coordinate workers. */
export class OutboxDrain {
  constructor(
    private pool: Pool,
    private worker: Pick<OutboxWorker, 'runOnce'>,
    private now: () => Date = () => new Date(),
  ) {}
  async run(): Promise<{ processed: number; failed: number; wakeAfterSeconds: number | null }> {
    const stopAt = this.now().getTime() + 20_000;
    let processed = 0;
    let failed = 0;
    // Check the budget between jobs; an in-flight provider operation retains its own timeout.
    for (let index = 0; index < 10 && this.now().getTime() < stopAt; index++) {
      const result = await this.worker.runOnce(1);
      processed += result.processed;
      failed += result.failed;
      if (result.processed + result.failed === 0) break;
    }
    const next = (
      await this.pool.query<{ due: Date | null }>(
        `SELECT min(GREATEST(available_at,COALESCE(locked_until,available_at))) AS due
       FROM outbox WHERE completed_at IS NULL AND dead_letter_at IS NULL`,
      )
    ).rows[0]?.due;
    return {
      processed,
      failed,
      // Wake at lease expiry after a crashed worker; don't hot-loop over its locked rows.
      wakeAfterSeconds: next
        ? Math.max(1, Math.min(3600, Math.ceil((next.getTime() - this.now().getTime()) / 1000)))
        : null,
    };
  }
}
