import type { RideDetails } from '@rove/contracts';
import { navigationTarget } from './directions';

export function assertNavigationActive(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Navigation cancelled.');
}

export type Target = NonNullable<ReturnType<typeof navigationTarget>>;
export interface GuidancePorts {
  load(signal: AbortSignal): Promise<RideDetails>;
  prepare(signal: AbortSignal): Promise<void>;
  route(target: Target, signal: AbortSignal): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  cleanup(): Promise<void>;
}

/** One owned-trip leg per session. No trip mutation or external-app fallback. */
export function createGuidance(ports: GuidancePorts) {
  const abort = new AbortController();
  let expected: RideDetails | undefined;
  let target: Target | undefined;
  let task: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  const check = () => assertNavigationActive(abort.signal);
  async function validate() {
    const updated = await ports.load(abort.signal);
    check();
    const next = navigationTarget(updated);
    if (
      !next ||
      (expected &&
        (updated.id !== expected.id ||
          updated.version < expected.version ||
          next.leg !== target?.leg ||
          next.point !== target?.point))
    )
      throw new Error('Your trip changed. Return to the trip to check the next step.');
    expected = updated;
    target = next;
    return next;
  }
  return {
    start() {
      task ??= (async () => {
        await validate();
        await ports.prepare(abort.signal);
        check();
        const next = await validate();
        await ports.route(next, abort.signal);
        check();
        await validate();
        await ports.start();
        check();
      })();
      return task;
    },
    validate,
    dispose() {
      if (disposal) return disposal;
      abort.abort();
      disposal = (async () => {
        // Stop promptly; repeat after pending native work so a late start cannot survive teardown.
        await ports.stop().catch(() => undefined);
        await task?.catch(() => undefined);
        await ports.stop().catch(() => undefined);
        await ports.cleanup();
      })();
      return disposal;
    },
  };
}
