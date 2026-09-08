import { QueueClient } from '@vercel/queue';
import { createRuntime } from './runtime';
import { WorkerScheduling } from './worker-scheduling';

export const queue = new QueueClient({ region: 'iad1' });
export const runtime = createRuntime(process.env);
export const scheduler = new WorkerScheduling(runtime, {
  async publish(delaySeconds) {
    // No rider, location, payment reference or credential enters the queue payload.
    await queue.send('rove-worker-wake', { version: 1 }, { delaySeconds, retentionSeconds: 86400 });
  },
});
