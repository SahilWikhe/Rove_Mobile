import { useState } from 'react';
import { Banner, Button, Card, Copy } from './index';
export function NotificationControls({
  settings,
  onManageDevices,
}: {
  onManageDevices: () => void;
  settings: {
    available: boolean;
    enabled: boolean;
    busy: boolean;
    error: string | null;
    notice?: string | null;
    lostProof?: boolean;
    reset?(): Promise<void>;
    repairable?: boolean;
    repair?(): Promise<void>;
    enable(): Promise<void>;
    disable(): Promise<void>;
  };
}) {
  return (
    <Card>
      <Copy kind="heading">Trip notifications</Copy>
      <Copy kind="muted">
        {!settings.available
          ? 'Push notifications are not available in this build yet.'
          : settings.enabled
            ? 'This device is registered for trip updates.'
            : 'Get a notification when your trip has an update.'}
      </Copy>
      {settings.notice && <Banner message={settings.notice} />}
      {settings.error && <Banner error message={settings.error} />}
      {settings.available && !settings.lostProof && (
        <Button
          variant="secondary"
          loading={settings.busy}
          title={
            settings.repairable
              ? 'Repair and enable notifications'
              : settings.enabled
                ? 'Turn off notifications'
                : 'Enable notifications'
          }
          onPress={() =>
            void (
              settings.repairable && settings.repair
                ? settings.repair()
                : settings.enabled
                  ? settings.disable()
                  : settings.enable()
            ).catch(() => undefined)
          }
        />
      )}
      {settings.available && settings.lostProof && settings.reset && (
        <LostProofRecovery busy={settings.busy} reset={settings.reset} onManageDevices={onManageDevices} />
      )}
      <Copy kind="muted">Open the app for current trip details. Notifications may be delayed.</Copy>
    </Card>
  );
}

function LostProofRecovery({
  busy,
  reset,
  onManageDevices,
}: {
  busy: boolean;
  reset: () => Promise<void>;
  onManageDevices: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        title="Manage notification devices"
        disabled={busy}
        onPress={onManageDevices}
      />
      {confirming ? (
        <>
          <Copy>Reset notification settings on this phone?</Copy>
          <Copy kind="muted">
            First turn off all notification devices listed for this account. Reset only changes this phone’s
            notification settings and leaves notifications off. Other phones stay signed in. If you still
            cannot enable notifications, contact support.
          </Copy>
          <Button
            title="Confirm notification reset"
            loading={busy}
            onPress={() => void reset().catch(() => undefined)}
          />
          <Button
            variant="secondary"
            title="Keep current settings"
            disabled={busy}
            onPress={() => setConfirming(false)}
          />
        </>
      ) : (
        <Button
          variant="secondary"
          title="Reset this device’s notification settings"
          disabled={busy}
          onPress={() => setConfirming(true)}
        />
      )}
    </>
  );
}
