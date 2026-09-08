import type { Capabilities, RideState } from '@rove/contracts';
import { DomainError } from './errors';

export type ActorRole = 'rider' | 'driver' | 'staff';
const transitions: Record<RideState, Partial<Record<RideState, readonly ActorRole[]>>> = {
  searching: { matched: ['staff'], cancelled: ['rider', 'staff'], no_driver_found: ['staff'] },
  matched: { en_route: ['driver'], searching: ['staff'], cancelled: ['rider', 'staff'] },
  en_route: { arrived: ['driver'], searching: ['staff'], cancelled: ['rider', 'staff'] },
  arrived: {
    in_progress: ['driver'],
    no_show: ['staff'],
    cancelled: ['rider', 'staff'],
    searching: ['staff'],
  },
  in_progress: { completed: ['driver'], interrupted: ['driver', 'staff'] },
  interrupted: { in_progress: ['staff'], terminated: ['staff'] },
  completed: {},
  cancelled: {},
  no_driver_found: {},
  no_show: {},
  terminated: {},
};
// Resource/assignment authorization is additionally required in each use case.
export function assertTransition(from: RideState, to: RideState, role: ActorRole): void {
  if (!transitions[from][to]?.includes(role))
    throw new DomainError('INVALID_TRANSITION', 'This action is unavailable for the current trip state.');
}
export function assertNotExpired(expiresAt: string, now: Date): void {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime())
    throw new DomainError('EXPIRED', 'This request has expired. Please refresh.');
}
export function capabilities(
  flags: { scheduling: boolean; weekly: boolean; monthly: boolean },
  now: Date,
): Capabilities {
  return {
    version: 1,
    scheduleCreate: flags.scheduling,
    scheduleWeekly: flags.scheduling && flags.weekly,
    scheduleMonthly: flags.scheduling && flags.monthly,
    evaluatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  };
}
