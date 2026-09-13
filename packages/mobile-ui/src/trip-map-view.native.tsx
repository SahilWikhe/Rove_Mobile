import { darkMapStyle } from './map-style';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Button, Card, Copy } from './index';
import type { TripMapProps } from './trip-map-types';
export function TripMap({
  pickup,
  route,
  height = 210,
  interactive = true,
  destination,
  androidEnabled,
  iosEnabled,
  synthetic,
  driver,
  followDriver = false,
  fill = false,
  topInset = 0,
  floating = false,
  bottomInset = 0,
}: TripMapProps) {
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [following, setFollowing] = useState(followDriver);
  const latitude = driver?.coordinate.latitude;
  const longitude = driver?.coordinate.longitude;
  useEffect(() => {
    if (ready && followDriver && following && latitude !== undefined && longitude !== undefined) {
      map.current?.setCamera({ center: { latitude, longitude }, zoom: 15 });
    }
  }, [ready, followDriver, following, latitude, longitude]);
  const initialTilesLoaded = useRef(false);
  const showFullTrip = () => {
    setFollowing(false);
    map.current?.fitToCoordinates(
      [pickup, destination, ...(route ?? []), ...(driver ? [driver.coordinate] : [])],
      {
        edgePadding: { top: 56 + topInset, right: 48, bottom: 56, left: 48 },
        animated: false,
      },
    );
  };
  const applePreview = Platform.OS === 'ios' && !!synthetic && !iosEnabled;
  const configured = Platform.OS === 'ios' ? iosEnabled : androidEnabled;
  if (!applePreview && !configured)
    return (
      <Card>
        <Copy kind="muted">The map is not configured yet. Your route details remain available below.</Copy>
      </Card>
    );
  const region = {
    latitude: (pickup.latitude + destination.latitude) / 2,
    longitude: (pickup.longitude + destination.longitude) / 2,
    latitudeDelta: Math.max(0.02, Math.abs(pickup.latitude - destination.latitude) * 1.5),
    longitudeDelta: Math.max(0.02, Math.abs(pickup.longitude - destination.longitude) * 1.5),
  };
  return (
    <View style={[styles.container, fill && { flex: 1 }]}>
      <View style={[styles.viewport, { height }, fill && styles.fillViewport]}>
        <MapView
          ref={map}
          pointerEvents={interactive ? 'auto' : 'none'}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          onMapReady={() => {
            setReady(true);
            if (!followDriver || !driver) showFullTrip();
            if (followDriver) setFollowing(true);
          }}
          onMapLoaded={() => {
            // Google can report ready before its initial camera/tiles settle.
            // Fit once after loading, without snapping back after user gestures.
            if (!initialTilesLoaded.current) {
              initialTilesLoaded.current = true;
              if (!followDriver || !driver) showFullTrip();
              if (followDriver) setFollowing(true);
            }
          }}
          onPanDrag={() => setFollowing(false)}
          provider={applePreview ? undefined : PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          {...(ready ? { mapPadding: { top: 0, right: 0, bottom: bottomInset, left: 0 } } : {})}
          userInterfaceStyle="dark"
          {...(!applePreview ? { customMapStyle: darkMapStyle } : {})}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass
          pitchEnabled={false}
          rotateEnabled={false}
          toolbarEnabled={false}
          accessibilityLabel={
            driver
              ? 'Trip map with pickup, destination and last reported driver location'
              : 'Trip map with pickup and destination markers'
          }
        >
          {route && route.length > 1 && (
            <Polyline coordinates={route} strokeColor="#CFB97D" strokeWidth={5} />
          )}
          <Marker coordinate={pickup} title="Pickup" pinColor="#D6B26D" />
          <Marker coordinate={destination} title="Destination" pinColor="#F4F0E8" />
          {driver && (
            <Marker
              coordinate={driver.coordinate}
              title="Driver last reported location"
              pinColor="#68B5FA"
              zIndex={10}
            />
          )}
        </MapView>
      </View>
      {floating ? (
        <View style={{ position: 'absolute', right: 16, bottom: bottomInset + 12 }}>
          <Button
            title="Show full trip"
            variant="secondary"
            disabled={!ready}
            onPress={showFullTrip}
            style={{ minHeight: 48, backgroundColor: 'rgba(10,10,10,0.85)', borderRadius: 24 }}
          />
        </View>
      ) : (
        <>
          <Button title="Show full trip" variant="secondary" disabled={!ready} onPress={showFullTrip} />
          {followDriver && driver && (
            <Button
              title={following ? 'Following driver' : 'Follow driver'}
              variant="secondary"
              disabled={!ready || following}
              onPress={() => setFollowing(true)}
            />
          )}
          <Copy kind="muted">
            {synthetic ? 'Synthetic route endpoints. ' : ''}
            {driver
              ? `Driver location last reported at ${new Date(driver.sampledAt).toLocaleTimeString()}.`
              : 'Pickup and destination markers.'}
          </Copy>
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 8 },
  viewport: { width: '100%', height: 210, borderRadius: 20, overflow: 'hidden' },
  fillViewport: { flex: 1, height: undefined, borderRadius: 0 },
});
