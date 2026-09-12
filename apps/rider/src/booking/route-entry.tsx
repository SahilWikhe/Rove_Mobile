import { Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { Place } from '@rove/contracts';
import { Copy, theme } from '@rove/mobile-ui';
import close from '../../assets/booking/close.png';
import clock from '../../assets/booking/clock.png';
import pickupIcon from '../../assets/booking/pickup.png';
import destinationIcon from '../../assets/booking/destination.png';
import placeIcon from '../../assets/booking/place.png';
// Rider Figma 4:20. Scheduling and extra stops require their own enabled capabilities.
export function BookingHeader({ onClose }: { onClose: () => void }) {
  return (
    <>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close booking"
          onPress={onClose}
          style={styles.close}
        >
          <Image source={close} style={styles.closeIcon} accessible={false} />
        </Pressable>
        <Copy style={styles.title}>Book a ride</Copy>
        <View style={styles.spacer} />
      </View>
      <View style={styles.now}>
        <Image source={clock} style={styles.clock} accessible={false} />
        <Copy style={styles.nowText}>Pick up now</Copy>
      </View>
    </>
  );
}
export function RouteEntry({
  pickup,
  destination,
  target,
  query,
  onEdit,
  onSearch,
}: {
  pickup: Place | null;
  destination: Place | null;
  target: 'pickup' | 'destination';
  query: string;
  onEdit: (target: 'pickup' | 'destination', text?: string) => void;
  onSearch: () => void;
}) {
  return (
    <View style={styles.route}>
      {(['pickup', 'destination'] as const).map((kind, i) => {
        const place = kind === 'pickup' ? pickup : destination;
        const active = target === kind && !place;
        return (
          <View key={kind} style={[styles.row, i === 1 && styles.divider]}>
            <Image
              source={kind === 'pickup' ? pickupIcon : destinationIcon}
              style={styles.dot}
              accessible={false}
            />
            {active ? (
              <View style={styles.field}>
                <Copy style={styles.label}>{kind === 'pickup' ? 'Start' : 'Destination'}</Copy>
                <TextInput
                  accessibilityLabel={kind === 'pickup' ? 'Pickup address' : 'Destination address'}
                  value={query}
                  onChangeText={(text) => onEdit(kind, text)}
                  placeholder={kind === 'pickup' ? 'Enter pickup address' : 'Where to?'}
                  placeholderTextColor={theme.muted}
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={onSearch}
                  style={styles.input}
                />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={place ? `Change ${kind}` : `Enter ${kind} address`}
                onPress={() => onEdit(kind)}
                style={styles.field}
              >
                <Copy style={styles.label}>{kind === 'pickup' ? 'Start' : 'Destination'}</Copy>
                <Copy style={[styles.address, !place && { color: theme.muted }]}>
                  {place?.label ?? (kind === 'pickup' ? 'Enter pickup address' : 'Where to?')}
                </Copy>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}
export function PlaceResult({ place, onPress }: { place: Place; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={place.label}
      onPress={onPress}
      style={({ pressed }) => [styles.result, pressed && styles.pressed]}
    >
      <Image source={placeIcon} style={styles.pin} accessible={false} />
      <View style={styles.resultText}>
        <Copy style={styles.address}>{place.label}</Copy>
        <Copy style={styles.area}>{place.area}</Copy>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  closeIcon: { width: 21, height: 21 },
  spacer: { width: 48 },
  title: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 17,
    lineHeight: 24,
    flexShrink: 1,
    textAlign: 'center',
  },
  now: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: theme.gold,
    backgroundColor: 'rgba(207,185,125,0.08)',
  },
  clock: { width: 16, height: 16 },
  nowText: { fontSize: 14, lineHeight: 21, fontFamily: 'Manrope_700Bold' },
  route: { backgroundColor: theme.raised, borderWidth: 1.5, borderColor: theme.gold, borderRadius: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, minHeight: 62 },
  divider: { borderTopWidth: 1, borderTopColor: 'rgba(207,185,125,0.4)' },
  dot: { width: 15, height: 15 },
  field: { flex: 1, minWidth: 0, paddingVertical: 10, minHeight: 60, justifyContent: 'center' },
  label: { fontSize: 12, lineHeight: 18, color: theme.muted },
  input: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 15,
    lineHeight: 23,
    color: theme.text,
    padding: 0,
    minHeight: 27,
  },
  address: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, lineHeight: 23 },
  result: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: 60,
    borderRadius: 12,
  },
  pressed: { backgroundColor: theme.surface },
  pin: { width: 23, height: 23 },
  resultText: { flex: 1, minWidth: 0, gap: 2 },
  area: { fontSize: 13, lineHeight: 20, color: theme.muted },
});
