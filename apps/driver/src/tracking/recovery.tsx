import { useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button } from '@rove/mobile-ui';
import { requestTrackingPermissions, unblockTracking, synchronizeBackgroundTracking } from './background';

export function TrackingRecovery({ message, disabled = false }: { message: string; disabled?: boolean }) {
  const { api, profile, synthetic } = useSession();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Location could not reconnect.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Banner error message={error ?? message} />
      {!synthetic && Platform.OS !== 'web' && profile?.role === 'driver' && (
        <>
          <Button
            title="Reconnect location"
            variant="secondary"
            disabled={disabled}
            loading={busy}
            onPress={() =>
              void run(async () => {
                await requestTrackingPermissions();
                await unblockTracking();
                await synchronizeBackgroundTracking(api, profile.id);
              })
            }
          />
          <Button
            title="Open location settings"
            variant="secondary"
            disabled={disabled || busy}
            onPress={() => void run(() => Linking.openSettings())}
          />
        </>
      )}
    </>
  );
}
