import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button } from '@rove/mobile-ui';
export function OpenConversation({ rideId }: { rideId: string }) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const current = useRef(true),
    pending = useRef(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
      controller.current?.abort();
    };
  }, [rideId]);
  async function open() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    controller.current = new AbortController();
    try {
      const c = await api.rideConversation(rideId, controller.current.signal);
      if (current.current) router.push({ pathname: '/conversation', params: { id: c.id } });
    } catch (e) {
      if (current.current) setError(e instanceof Error ? e.message : 'Messaging unavailable.');
    } finally {
      pending.current = false;
      if (current.current) setBusy(false);
    }
  }
  return (
    <>
      {error && <Banner error message={error} />}
      <Button title="Message rider" variant="secondary" loading={busy} onPress={open} />
    </>
  );
}
