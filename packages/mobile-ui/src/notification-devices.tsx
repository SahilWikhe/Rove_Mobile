import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Card, Copy } from './index';
type Device = { id: string; revision: number; platform: 'ios' | 'android'; registeredAt: string };
const label = (device: Device) =>
  `${device.platform === 'ios' ? 'iOS' : 'Android'} · ${device.id.slice(-6).toUpperCase()}`;
/** Mount with the account ID as key; no device data survives an account change. */
export function NotificationDevices({
  list,
  revoke,
  newKey,
}: {
  list: (signal?: AbortSignal) => Promise<{ devices: Device[] }>;
  revoke: (device: Device, key: string) => Promise<unknown>;
  newKey: () => string;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ device: Device; key: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true),
    running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setDevices([]);
    setSelected(null);
    setError(null);
    void list(controller.signal)
      .then((result) => {
        if (active) setDevices(result.devices);
      })
      .catch(() => {
        if (active) setError('Device settings could not be loaded. Please retry.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [list, refresh]);
  async function confirm() {
    if (!selected || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await revoke(selected.device, selected.key);
      if (!alive.current) return;
      setNotice(`Notifications turned off for ${label(selected.device)}.`);
      setSelected(null);
      setRefresh((value) => value + 1);
    } catch {
      if (alive.current)
        setError('The change could not be confirmed. Retry, or refresh if this device changed.');
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <Copy kind="heading">Your notification devices</Copy>
      <Copy kind="muted">
        Turn off trip updates on a device you no longer use. This changes notifications only.
      </Copy>
      {notice && <Banner message={notice} />}
      {error && <Banner error message={error} />}
      {loading && <Copy kind="muted">Loading devices…</Copy>}
      {!loading && !error && devices.length === 0 && (
        <Card>
          <Copy>No notification devices yet.</Copy>
          <Copy kind="muted">Enable trip notifications from your phone’s account settings.</Copy>
        </Card>
      )}
      {devices.map((device) => (
        <Card key={device.id}>
          <Copy kind="heading">{label(device)}</Copy>
          <Copy kind="muted">Last registered {new Date(device.registeredAt).toLocaleString()}</Copy>
          {selected?.device.id === device.id ? (
            <>
              <Copy kind="heading">Turn off {label(selected.device)}?</Copy>
              <Copy kind="muted">
                This device will stop receiving new trip notifications. You can enable them again from that
                phone.
              </Copy>
              <Button title="Confirm turn off" loading={busy} onPress={() => void confirm()} />
              <Button
                title="Keep notifications"
                variant="secondary"
                disabled={busy}
                onPress={() => setSelected(null)}
              />
            </>
          ) : (
            <Button
              title={`Turn off ${label(device)}`}
              variant="secondary"
              disabled={busy || loading}
              onPress={() => {
                setSelected({ device, key: newKey() });
                setError(null);
                setNotice(null);
              }}
            />
          )}
        </Card>
      ))}
      <Button
        title="Refresh devices"
        variant="secondary"
        disabled={busy || loading}
        onPress={() => {
          setNotice(null);
          setRefresh((value) => value + 1);
        }}
      />
    </>
  );
}
