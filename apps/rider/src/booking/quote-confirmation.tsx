import { RoutePreview } from './route-preview';
import { useEffect, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, View } from 'react-native';
import type { Quote } from '@rove/contracts';
import { Banner, Button, Card, Copy, theme } from '@rove/mobile-ui';
import { serviceLabels } from './service-picker';
import back from '../../assets/confirmation/back.png';
import pickup from '../../assets/confirmation/pickup.png';
import destination from '../../assets/confirmation/destination.png';
// Rider Figma 5:89; consumer quote data replaces scheduling and coverage examples.
export function QuoteConfirmation({
  quote,
  synthetic,
  loading,
  onEdit,
  onConfirm,
}: {
  quote: Quote;
  synthetic: boolean;
  loading: boolean;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const deadline = Date.parse(quote.expiresAt);
  const [expired, setExpired] = useState(() => !(deadline > Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      const remaining = deadline - Date.now();
      setExpired(!(remaining > 0));
      if (remaining > 0) timer = setTimeout(refresh, Math.min(remaining, 2_147_483_647));
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [deadline]);
  const fare = new Intl.NumberFormat('en-US', { style: 'currency', currency: quote.fare.currency }).format(
    quote.fare.amount / 100,
  );
  return (
    <>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit route or service"
          accessibilityState={{ disabled: loading }}
          disabled={loading}
          onPress={onEdit}
          style={styles.backTarget}
        >
          <View style={styles.backCircle}>
            <Image source={back} style={styles.backIcon} accessible={false} />
          </View>
        </Pressable>
        <Copy style={styles.heading}>Confirm your ride</Copy>
        <View style={styles.spacer} />
      </View>
      <RoutePreview quote={quote} />
      <Card style={styles.card}>
        <View style={styles.routeRow}>
          <Image source={pickup} style={styles.dot} accessible={false} />
          <Copy style={styles.address}>Pickup: {quote.pickup.label}</Copy>
        </View>
        <View style={styles.connector} />
        <View style={styles.routeRow}>
          <Image source={destination} style={styles.dot} accessible={false} />
          <Copy style={styles.address}>Destination: {quote.destination.label}</Copy>
        </View>
        <View style={styles.separator} />
        <Detail label="Ride" value={serviceLabels[quote.service]} />
        <Detail label="Estimated trip" value={`${Math.ceil(quote.durationSeconds / 60)} min`} />
        <Detail label="Distance" value={`${(quote.distanceMeters / 1000).toFixed(1)} km`} />
        <Detail label="Your fare" value={fare} />
      </Card>
      {synthetic && <Copy style={styles.test}>TEST MODE · NO REAL RIDES OR PAYMENTS</Copy>}
      <Copy style={styles.description}>
        A quote does not reserve a driver. You’ll see the matching status after requesting. Trip time
        estimates do not include the wait for pickup.
      </Copy>
      {expired && (
        <Banner message="This fare has expired. Review an updated fare before requesting your ride." />
      )}
      {!expired && (
        <Copy style={styles.description}>
          Fare valid until{' '}
          {new Date(deadline).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.
        </Copy>
      )}
      <Button
        title={expired ? 'Review updated fare' : 'Request ride'}
        onPress={expired ? onEdit : onConfirm}
        loading={loading}
        style={styles.primary}
        textStyle={styles.primaryText}
      />
      <Button
        title="Change route or service"
        variant="secondary"
        disabled={loading}
        onPress={onEdit}
        style={styles.secondary}
        textStyle={styles.secondaryText}
      />
    </>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Copy style={styles.label}>{label}</Copy>
      <Copy style={styles.value}>{value}</Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  backTarget: { width: 48, height: 48, justifyContent: 'center' },
  backCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { width: 17, height: 17 },
  spacer: { width: 48 },
  heading: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    lineHeight: 22,
    flexShrink: 1,
    textAlign: 'center',
  },
  card: { padding: 20, borderRadius: 18, borderColor: 'rgba(255,255,255,0.07)', gap: 2 },
  routeRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  dot: { width: 8, height: 8 },
  address: { fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 21, flex: 1 },
  connector: { marginLeft: 3, width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.18)' },
  separator: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 16 },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingBottom: 10 },
  label: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 20, color: theme.muted, flex: 1 },
  value: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, lineHeight: 20, flex: 1, textAlign: 'right' },
  description: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 20, color: theme.muted },
  test: { fontSize: 10, lineHeight: 16, color: theme.muted },
  primary: { marginTop: 8, minHeight: 52, borderRadius: 26, paddingVertical: 14 },
  primaryText: { fontSize: 15 },
  secondary: { minHeight: 52, borderRadius: 26, paddingVertical: 14 },
  secondaryText: { fontSize: 14 },
});
