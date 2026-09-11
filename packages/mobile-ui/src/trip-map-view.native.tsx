import { darkMapStyle } from './map-style';
import { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Button, Card, Copy } from './index';
import type { TripMapProps } from './trip-map-types';
export function TripMap({
  pickup,
  destination,
  androidEnabled,
  iosEnabled,
  synthetic,
  driver,
  fill = false,
}: TripMapProps) {
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const initialTilesLoaded = useRef(false);
  const showFullTrip = () => {
    map.current?.fitToCoordinates([pickup, destination, ...(driver ? [driver.coordinate] : [])], {
      edgePadding: { top: 56, right: 48, bottom: 56, left: 48 },
      animated: false,
    });
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
      <View style={[styles.viewport, fill && styles.fillViewport]}>
        <MapView
          ref={map}
          onMapReady={() => {
            setReady(true);
            showFullTrip();
          }}
          onMapLoaded={() => {
            // Google can report ready before its initial camera/tiles settle.
            // Fit once after loading, without snapping back after user gestures.
            if (!initialTilesLoaded.current) {
              initialTilesLoaded.current = true;
              showFullTrip();
            }
          }}
          provider={applePreview ? undefined : PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
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
          <Marker coordinate={pickup} title="Pickup" pinColor="#D6B26D" />
          <Marker coordinate={destination} title="Destination" pinColor="#F4F0E8" />
          {driver && (
            <Marker coordinate={driver.coordinate} title="Driver last reported location" pinColor="#68B5FA" />
          )}
        </MapView>
      </View>
      <Button title="Show full trip" variant="secondary" disabled={!ready} onPress={showFullTrip} />
      <Copy kind="muted">
        {synthetic ? 'Synthetic route endpoints. ' : ''}
        {driver
          ? `Driver location last reported at ${new Date(driver.sampledAt).toLocaleTimeString()}.`
          : 'Pickup and destination markers.'}
      </Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 8 },
  viewport: { width: '100%', height: 210, borderRadius: 20, overflow: 'hidden' },
  fillViewport: { flex: 1, height: undefined, borderRadius: 0 },
});
