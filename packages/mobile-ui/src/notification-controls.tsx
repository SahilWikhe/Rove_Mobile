import { Banner, Button, Card, Copy } from './index';
export function NotificationControls({
  settings,
}: {
  settings: {
    available: boolean;
    enabled: boolean;
    busy: boolean;
    error: string | null;
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
      {settings.error && <Banner error message={settings.error} />}
      {settings.available && (
        <Button
          variant="secondary"
          loading={settings.busy}
          title={settings.enabled ? 'Turn off notifications' : 'Enable notifications'}
          onPress={() =>
            void (settings.enabled ? settings.disable() : settings.enable()).catch(() => undefined)
          }
        />
      )}
      <Copy kind="muted">Open the app for current trip details. Notifications may be delayed.</Copy>
    </Card>
  );
}
