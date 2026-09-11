import { darkMapStyle } from '@rove/mobile-ui/map-style';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Copy, theme } from '@rove/mobile-ui';
import { currentPosition } from '../tracking/provider';
import type { LocationSample } from '@rove/mobile-core/driver-tracking';

/** Local display only. The tracking provider owns server heartbeats and availability. */
export function WaitingMap({ synthetic }: { synthetic: boolean }) {
  const [sample, setSample] = useState<LocationSample | null>(null);
  const [failed, setFailed] = useState(false);
  const applePreview = Platform.OS === 'ios' && synthetic && !process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY;
  const configured =
    applePreview ||
    Boolean(
      Platform.OS === 'ios'
        ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY
        : process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY,
    );
  useEffect(() => {
    if (!configured) return;
    let disposed = false;
    setSample(null);
    setFailed(false);
    void currentPosition(synthetic)
      .then((position) => {
        if (!disposed) setSample(position);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, [configured, synthetic]);
  if (!configured || !sample)
    return (
      <View style={styles.message}>
        <Copy kind="muted">
          {!configured
            ? 'The map is not configured yet.'
            : failed
              ? 'Your location is unavailable. Check location permissions in Settings.'
              : 'Finding your location…'}
        </Copy>
      </View>
    );
  return (
    <MapView
      style={StyleSheet.absoluteFill}
      provider={applePreview ? undefined : PROVIDER_GOOGLE}
      initialRegion={{ ...sample.coordinate, latitudeDelta: 0.025, longitudeDelta: 0.025 }}
      userInterfaceStyle="dark"
      {...(!applePreview ? { customMapStyle: darkMapStyle } : {})}
      showsUserLocation={!synthetic}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      pitchEnabled={false}
      rotateEnabled={false}
      accessibilityLabel={
        synthetic ? 'Map showing a synthetic test location' : 'Map showing your current location'
      }
    >
      {synthetic && (
        <Marker coordinate={sample.coordinate} title="Synthetic test location" pinColor={theme.gold} />
      )}
    </MapView>
  );
}
const styles = StyleSheet.create({
  message: { flex: 1, backgroundColor: theme.raised, justifyContent: 'center', padding: 24 },
});
