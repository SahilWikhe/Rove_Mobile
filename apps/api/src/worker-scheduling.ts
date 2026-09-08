import { z } from 'zod';
const Wake = z.object({ version: z.literal(1) }).strict();
export interface WakePublisher {
  publish(delaySeconds: number): Promise<void>;
}
export interface WorkerTasks {
  drain: { run(): Promise<{ processed: number; failed: number; wakeAfterSeconds: number | null }> };
  searchExpiry: { sweep(): Promise<number> };
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
    const result = await this.tasks.drain.run();
    if (result.wakeAfterSeconds !== null) await this.publisher.publish(result.wakeAfterSeconds);
    // A failed publish must throw so the current queue message is not acknowledged.
    return result;
  }
  async recover() {
    await this.tasks.searchExpiry.sweep();
    return this.consume({ version: 1 });
  }
}
