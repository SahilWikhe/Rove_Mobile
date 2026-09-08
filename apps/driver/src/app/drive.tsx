import { currentPosition, useTrackingError } from '../tracking/provider';
import { useCallback, useState } from 'react';
import { AppState, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import type { DriverProfile, DriverOffer, RideDetails } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Brand, Button, Card, Copy, Screen, theme } from '@rove/mobile-ui';
export default function Drive() {
  const { api, synthetic } = useSession(); const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [offer, setOffer] = useState<DriverOffer | null>(null); const [active, setActive] = useState<RideDetails | null>(null);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const trackingError = useTrackingError();
  useFocusEffect(useCallback(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (AppState.currentState !== 'active') { timer = setTimeout(refresh, 3000); return; }
      try {
        const [driver, offered, history] = await Promise.all([api.driverProfile(), api.offers(), api.rides()]);
        if (!stopped) { setProfile(driver); setOffer(offered.offers[0] ?? null); setActive(history.rides.find(ride => ['matched', 'en_route', 'arrived', 'in_progress', 'interrupted'].includes(ride.state)) ?? null); }
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : 'Connection unavailable.'); }
      finally { if (!stopped) timer = setTimeout(refresh, 3000); }
    }
    void refresh(); return () => { stopped = true; clearTimeout(timer); };
  }, [api]));
  async function availability() {
    if (!profile) return; setBusy(true); setError(null);
    try {
      if (!profile.online && !synthetic) { const permission = await Location.requestForegroundPermissionsAsync(); if (permission.status !== 'granted') throw new Error('Allow location access in Settings to go online.'); }
      const sample = profile.online ? undefined : await currentPosition(synthetic);
      await api.availability(!profile.online, sample?.coordinate, Crypto.randomUUID()); const updated = await api.driverProfile(); setProfile(updated);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Availability could not be updated.'); }
    finally { setBusy(false); }
  }
  return <Screen><Stack.Screen options={{ headerShown: false }} /><Brand driver />{synthetic && <Banner message="Synthetic test mode · no real rides or payments" />}<Copy kind="title">{profile?.online ? 'You’re online.' : 'Ready when you are.'}</Copy>{error && <Banner error message={error} />}{trackingError && <Banner error message={trackingError} />}
    <Card style={{ minHeight: 160, justifyContent: 'center', alignItems: 'center' }}><View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: profile?.online ? theme.gold : theme.raised, alignItems: 'center', justifyContent: 'center' }}><Copy style={{ color: profile?.online ? theme.background : theme.muted }}>↑</Copy></View><Copy kind="heading">{active ? 'Your trip is active' : offer ? 'A new ride request' : profile?.online ? 'Looking for your next trip' : 'You’re offline'}</Copy><Copy kind="muted">{profile?.online ? 'Keep your location available for matching.' : 'Go online when you’re ready to drive.'}</Copy></Card>
    {active ? <Button title="Continue your trip" onPress={() => router.push({ pathname: '/trip', params: { id: active.id } })} /> : offer ? <Button title="View ride request" onPress={() => router.push({ pathname: '/offer', params: { id: offer.id } })} /> : null}
    {profile && !profile.eligible && <Banner message="Complete your document review and payout setup before going online." />}
    <Button title={profile?.online ? 'Go offline' : 'Go online'} disabled={!profile || (!profile.online && !profile.eligible) || Boolean(active)} loading={busy} onPress={() => void availability()} />
    <Button title="Trips & earnings" variant="secondary" onPress={() => router.push('/trips')} />
  </Screen>;
}
