import { useCallback, useRef, useState } from 'react';
import { Stack, useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Field, Screen } from '@rove/mobile-ui';

export default function Coverage() {
  const { api, profile } = useSession();
  const loadRequest = useRef<AbortController | null>(null);
  const [radius, setRadius] = useState('25');
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const pending = useRef<{ radius: number; key: string } | null>(null);
  const running = useRef(false);
  const load = useCallback(() => {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setSaved(null);
    setConfirmed(false);
    if (profile?.role === 'driver')
      void api
        .driverProfile(controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            setSaved(value.coverageRadiusMiles);
            if (!pending.current) setRadius(String(value.coverageRadiusMiles));
            setError(null);
          }
        })
        .catch((failure) => {
          if (!controller.signal.aborted)
            setError(failure instanceof Error ? failure.message : 'Coverage could not be loaded.');
        });
  }, [api, profile?.role]);
  useFocusEffect(
    useCallback(() => {
      load();
      return () => loadRequest.current?.abort();
    }, [load]),
  );
  const value = Number(radius);
  const valid = /^\d+$/.test(radius) && Number.isInteger(value) && value >= 1 && value <= 100;
  async function save() {
    if (running.current || saved === null || !valid) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setConfirmed(false);
    pending.current ??= { radius: value, key: Crypto.randomUUID() };
    try {
      const result = await api.driverCoverage(pending.current.radius, pending.current.key);
      setSaved(result.radiusMiles);
      setRadius(String(result.radiusMiles));
      pending.current = null;
      setConfirmed(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Coverage save could not be confirmed. Retry to check the same save.',
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: 'Coverage radius' }} />
      <Copy kind="title">Find rides nearby.</Copy>
      <Copy kind="muted">
        Choose how far from your current location you want to receive new pickup offers.
      </Copy>
      {error && <Banner error message={error} />}
      {saved === null && profile?.role === 'driver' && (
        <Button title="Reload coverage" variant="secondary" onPress={load} />
      )}
      {profile?.role !== 'driver' ? (
        <Copy>Sign in as a driver to change your coverage.</Copy>
      ) : (
        <Card>
          <Field
            label="Pickup radius (miles)"
            value={radius}
            onChangeText={(text) => {
              setRadius(text);
              setConfirmed(false);
            }}
            keyboardType="number-pad"
            maxLength={3}
            editable={saved !== null && !busy && !pending.current}
          />
          <Copy kind="muted">1–100 miles · Default: 25 miles</Copy>
          {!valid && <Banner error message="Enter a whole number from 1 to 100 miles." />}
          <Button
            title={pending.current ? 'Retry coverage save' : 'Save coverage'}
            loading={busy}
            disabled={saved === null || !valid || (!pending.current && value === saved)}
            onPress={() => void save()}
          />
          {confirmed && <Banner message={`Coverage saved: ${saved} miles.`} />}
        </Card>
      )}
      <Copy kind="muted">
        This is a straight-line radius around your latest location, not driving distance. Pickup-time and
        eligibility limits still apply. A larger radius does not guarantee more offers.
      </Copy>
      <Copy kind="muted">
        Changes apply to new offers. An offer already sent to you and any accepted trip stay unchanged.
      </Copy>
    </Screen>
  );
}
