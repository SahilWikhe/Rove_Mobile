import { PushHint } from '@rove/contracts';
import { createLatestRequest } from './latest-request';

export type NotificationTarget = {
  pathname: '/ride' | '/trip' | '/offer' | '/conversation';
  params: { id: string };
};
interface Resources {
  conversation?(id: string, signal?: AbortSignal): Promise<{ conversation: { id: string } }>;
  ride(id: string, signal?: AbortSignal): Promise<{ id: string }>;
  offers(signal?: AbortSignal): Promise<{ offers: { id: string; expiresAt: string }[] }>;
}

/** Payloads are hints, never routes, authorization or instructions to mutate a ride. */
export function createNotificationTaps(
  role: 'rider' | 'driver',
  api: Resources,
  currentSession: () => boolean,
  navigate: (target: NotificationTarget) => void,
  now = Date.now,
) {
  const latest = createLatestRequest();
  const seen = new Set<string>();
  return {
    cancel: latest.cancel,
    async open(data: unknown): Promise<'opened' | 'ignored' | 'unavailable'> {
      const parsed = PushHint.safeParse(data);
      if (!parsed.success || !currentSession()) return 'ignored';
      const hint = parsed.data;
      if (hint.kind === 'offer_available' && role !== 'driver') return 'ignored';
      if (seen.has(hint.eventId)) return 'ignored';
      seen.add(hint.eventId);
      // Bound memory over a long signed-in session. The OS response is consumed separately.
      if (seen.size > 128) seen.delete(seen.values().next().value!);
      const request = latest.start();
      const current = () => request.current() && currentSession();
      try {
        let pathname: NotificationTarget['pathname'];
        if (hint.kind === 'message_available') {
          if (!api.conversation) return 'unavailable';
          const result = await api.conversation(hint.referenceId, request.signal);
          if (!current()) return 'ignored';
          if (result.conversation.id !== hint.referenceId) return 'unavailable';
          pathname = '/conversation';
        } else if (hint.kind === 'ride_update') {
          const ride = await api.ride(hint.referenceId, request.signal);
          if (!current()) return 'ignored';
          if (ride.id !== hint.referenceId) return 'unavailable';
          pathname = role === 'rider' ? '/ride' : '/trip';
        } else {
          const { offers } = await api.offers(request.signal);
          if (!current()) return 'ignored';
          const offer = offers.find((item) => item.id === hint.referenceId);
          if (!offer || !(Date.parse(offer.expiresAt) > now())) return 'unavailable';
          pathname = '/offer';
        }
        if (!current()) return 'ignored';
        navigate({ pathname, params: { id: hint.referenceId } });
        return 'opened';
      } catch {
        return current() ? 'unavailable' : 'ignored';
      }
    },
  };
}
