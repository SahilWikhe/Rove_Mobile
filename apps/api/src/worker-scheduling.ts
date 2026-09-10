import { z } from 'zod';
const Wake = z.object({ version: z.literal(1) }).strict();
export interface WakePublisher {
  publish(delaySeconds: number): Promise<void>;
}
export interface WorkerTasks {
  documentScans?: { runOnce(): Promise<unknown>; nextWakeAfterSeconds(): Promise<number | null> };
  drain: { run(): Promise<{ processed: number; failed: number; wakeAfterSeconds: number | null }> };
  searchExpiry: { sweep(): Promise<number> };
  pushDelivery?: { sweep(): Promise<number> };
  payoutReconciliation?: { sweep(): Promise<number> };
}
export class WorkerScheduling {
  constructor(
    private tasks: WorkerTasks,
    private publisher: WakePublisher,
  ) {}
  async wake() {
    await this.publisher.publish(0);
  }
  async consume(message: unknown) {
    Wake.parse(message);
    // One bounded scan check runs alongside ride/payment work; it does not occupy outbox slots.
    const [result] = await Promise.all([this.tasks.drain.run(), this.tasks.documentScans?.runOnce()]);
    const scanWake = await this.tasks.documentScans?.nextWakeAfterSeconds();
    const wakes = [result.wakeAfterSeconds, scanWake].filter((value): value is number => value != null);
    const wakeAfterSeconds = wakes.length ? Math.min(...wakes) : null;
    if (wakeAfterSeconds !== null) await this.publisher.publish(wakeAfterSeconds);
    // A failed publish must throw so the current queue message is not acknowledged.
    return { ...result, wakeAfterSeconds };
  }
  async recover() {
    await this.tasks.searchExpiry.sweep();
    await this.tasks.payoutReconciliation?.sweep();
    await this.tasks.pushDelivery?.sweep();
    return this.consume({ version: 1 });
  }
}
