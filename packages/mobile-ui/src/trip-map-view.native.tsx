import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Card, Copy } from './index';
import type { TripMapProps } from './trip-map-types';
export function TripMap({ pickup, destination, androidEnabled, iosEnabled, synthetic }: TripMapProps) {
  const applePreview = Platform.OS === 'ios' && !!synthetic;
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
    <View style={styles.container}>
      <MapView
        provider={applePreview ? undefined : PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={region}
        userInterfaceStyle="dark"
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass
        pitchEnabled={false}
        rotateEnabled={false}
        toolbarEnabled={false}
        accessibilityLabel="Trip map with pickup and destination markers"
      >
        <Marker coordinate={pickup} title="Pickup" pinColor="#D6B26D" />
        <Marker coordinate={destination} title="Destination" pinColor="#F4F0E8" />
      </MapView>
      <Copy kind="muted">
        {synthetic ? 'Synthetic route endpoints. ' : ''}Pickup and destination only; live driver tracking is
        not available yet.
      </Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 8 },
  map: { width: '100%', height: 260, borderRadius: 16 },
});
