import { queue, scheduler } from '../src/deployment';

// Private queue-triggered function. No public Hono route forwards requests here.
export default queue.handleNodeCallback(async (message) => {
  await scheduler.consume(message);
});
