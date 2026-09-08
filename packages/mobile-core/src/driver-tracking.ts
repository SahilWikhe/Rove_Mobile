import type { Heartbeat as HeartbeatSchema } from '@rove/contracts';
import type { z } from 'zod';
type Heartbeat = z.infer<typeof HeartbeatSchema>;

export type LocationSample = Omit<Heartbeat, 'sequence'>;
interface TrackingDependencies {
  profile(signal: AbortSignal): Promise<{ online: boolean; locationSequence: number }>;
  position(): Promise<LocationSample>;
  heartbeat(sample: Heartbeat, signal: AbortSignal): Promise<unknown>;
  report(error: string | null): void;
}

/** One foreground session, owned by the app layout rather than any route.
 * Samples are never queued for later upload: stale GPS data cannot keep a driver eligible.
 */
export class DriverTracking {
  private active = false;
  private running = false;
  private generation = 0;
  private request: AbortController | null = null;

  constructor(private dependencies: TrackingDependencies) {}

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.generation++;
    if (!active) {
      this.request?.abort();
      this.request = null;
    }
  }

  async tick() {
    if (!this.active || this.running) return;
    this.running = true;
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    const current = () => this.active && generation === this.generation && !request.signal.aborted;
    try {
      // Reading the server cursor handles app restarts and availability changes.
      const profile = await this.dependencies.profile(request.signal);
      if (!current()) return;
      if (!profile.online) {
        this.dependencies.report(null);
        return;
      }
      const sample = await this.dependencies.position();
      if (!current()) return;
      await this.dependencies.heartbeat({ ...sample, sequence: profile.locationSequence + 1 }, request.signal);
      if (current()) this.dependencies.report(null);
    } catch {
      if (current()) this.dependencies.report('Location could not be updated. Check your connection and location permission.');
    } finally {
      if (this.request === request) this.request = null;
      this.running = false;
    }
  }
}
