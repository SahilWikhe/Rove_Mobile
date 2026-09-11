import { useCallback, useRef, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { VehicleSubmission, type VehicleReview } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy, Field, Screen } from '@rove/mobile-ui';
import { VehicleReviewStatus } from '../vehicle/review-status';
import { stopBackgroundTracking } from '../tracking/background';
type Draft = {
  make: string;
  model: string;
  year: string;
  color: string;
  plate: string;
  registrationRegion: string;
  requestedService: 'standard' | 'accessible';
};
const empty: Draft = {
  make: '',
  model: '',
  year: '',
  color: '',
  plate: '',
  registrationRegion: '',
  requestedService: 'standard',
};
export default function Vehicle() {
  const { profile } = useSession();
  return <VehicleForm key={profile?.id ?? 'signed-out'} />;
}
function VehicleForm() {
  const { api, profile } = useSession();
  const [draft, setDraft] = useState<Draft>(empty);
  const [submission, setSubmission] = useState<VehicleReview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0),
    saving = useRef(false);
  useFocusEffect(
    useCallback(() => {
      void refresh;
      const generation = ++epoch.current;
      setLoaded(false);
      setError(null);
      setConfirm(false);
      if (profile)
        void Promise.all([api.vehicleSubmission(), api.driverProfile()])
          .then(([result, driver]) => {
            if (epoch.current !== generation) return;
            setSubmission(result.submission);
            setOnline(driver.online);
            setDraft(
              result.submission
                ? { ...result.submission.vehicle, year: String(result.submission.vehicle.year) }
                : empty,
            );
            setLoaded(true);
          })
          .catch((failure) => {
            if (epoch.current === generation)
              setError(failure instanceof Error ? failure.message : 'Unable to load vehicle.');
          });
      return () => {
        epoch.current++;
      };
    }, [api, profile, refresh]),
  );
  const parsed = VehicleSubmission.safeParse({ ...draft, year: Number(draft.year) });
  async function submit() {
    if (saving.current || !parsed.success) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    const generation = epoch.current;
    try {
      const result = await api.submitVehicle(parsed.data, submission?.revision ?? null);
      if (epoch.current !== generation) return;
      setSubmission(result.submission);
      setConfirm(false);
      try {
        await stopBackgroundTracking();
      } catch {
        if (epoch.current === generation)
          setError('Vehicle submitted. Reopen the app to confirm device location sharing has stopped.');
      }
    } catch (failure) {
      if (epoch.current === generation)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Unable to submit. Reload to check the saved result before trying again.',
        );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (!profile)
    return (
      <Screen underHeader>
        <Copy>Sign in to manage your vehicle.</Copy>
        <Button title="Sign in" onPress={() => router.replace('/')} />
      </Screen>
    );
  return (
    <Screen underHeader>
      <Stack.Screen options={{ title: 'Your vehicle' }} />
      <Copy kind="title">Your vehicle.</Copy>
      {error && <Banner error message={error} />}
      {!loaded ? (
        <>
          <Copy>Load your current submission before editing.</Copy>
          <Button title="Reload vehicle" onPress={() => setRefresh((value) => value + 1)} />
        </>
      ) : (
        <>
          <VehicleReviewStatus submission={submission} />
          <Button
            title="Ask for help with this review"
            variant="secondary"
            disabled={busy}
            onPress={() => router.push('/support')}
          />
          {online ? (
            <>
              <Banner message="Go offline before submitting vehicle changes." />
              <Button title="Back to Drive" onPress={() => router.replace('/drive')} />
            </>
          ) : (
            <>
              {confirm ? (
                <Card>
                  <Copy kind="heading">Review your submission.</Copy>
                  <Copy>
                    {draft.year} {draft.make} {draft.model} · {draft.color}
                  </Copy>
                  <Copy>
                    {draft.plate} · {draft.registrationRegion}
                  </Copy>
                  <Copy>Requested service: {draft.requestedService}</Copy>
                  <Banner message="Submitting vehicle changes pauses driving approval until a new review is completed." />
                  <Button title="Submit for review" loading={busy} onPress={() => void submit()} />
                  <Button
                    title="Keep editing"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setConfirm(false)}
                  />
                </Card>
              ) : (
                <>
                  {(['make', 'model', 'year', 'color', 'plate', 'registrationRegion'] as const).map(
                    (field) => (
                      <Field
                        key={field}
                        label={
                          {
                            make: 'Make',
                            model: 'Model',
                            year: 'Model year',
                            color: 'Color',
                            plate: 'License plate',
                            registrationRegion: 'Registration state / region (two letters)',
                          }[field]
                        }
                        value={draft[field]}
                        editable={!busy}
                        keyboardType={field === 'year' ? 'number-pad' : 'default'}
                        autoCapitalize={
                          field === 'registrationRegion' || field === 'plate' ? 'characters' : 'words'
                        }
                        onChangeText={(value) =>
                          setDraft((current) => ({
                            ...current,
                            [field]: field === 'registrationRegion' ? value.toUpperCase() : value,
                          }))
                        }
                      />
                    ),
                  )}
                  <Copy kind="heading">Requested service</Copy>
                  <Button
                    title={draft.requestedService === 'standard' ? 'Standard · Selected' : 'Standard'}
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setDraft((current) => ({ ...current, requestedService: 'standard' }))}
                  />
                  <Button
                    title={draft.requestedService === 'accessible' ? 'Accessible · Selected' : 'Accessible'}
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setDraft((current) => ({ ...current, requestedService: 'accessible' }))}
                  />
                  <Copy kind="muted">
                    Accessible service requires separate verification of vehicle capability.
                  </Copy>
                  {!parsed.success && (
                    <Copy kind="muted">
                      Complete every field. Use a four-digit year and two-letter registration region.
                    </Copy>
                  )}
                  <Button
                    title="Review vehicle details"
                    disabled={!parsed.success || busy}
                    onPress={() => setConfirm(true)}
                  />
                </>
              )}
            </>
          )}
          <Button
            title="Reload saved vehicle"
            variant="secondary"
            disabled={busy}
            onPress={() => setRefresh((value) => value + 1)}
          />
        </>
      )}
    </Screen>
  );
}
