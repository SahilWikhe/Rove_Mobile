import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Copy, theme } from '@rove/mobile-ui';

type Estimate = { seconds: number; meters: number };
export function GuidanceFooter({
  readEstimate,
  onEnd,
}: {
  readEstimate: () => Promise<Estimate>;
  onEnd: () => void;
}) {
  const [estimate, setEstimate] = useState<(Estimate & { receivedAt: number }) | null>(null);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await readEstimate();
        if (
          !Number.isFinite(value.seconds) ||
          !Number.isFinite(value.meters) ||
          value.seconds < 0 ||
          value.meters < 0
        )
          throw new Error('Unavailable estimate');
        if (!disposed) setEstimate({ ...value, receivedAt: Date.now() });
      } catch {
        if (!disposed) setEstimate(null);
      } finally {
        pending = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [readEstimate]);
  return (
    <View style={styles.footer}>
      <View style={styles.estimate}>
        <Copy style={styles.time}>
          {estimate ? `${Math.max(1, Math.ceil(estimate.seconds / 60))} min` : 'Updating ETA…'}
        </Copy>
        {estimate && (
          <Copy style={styles.detail}>
            {(estimate.meters / 1609.344).toFixed(1)} mi ·{' '}
            {new Date(estimate.receivedAt + estimate.seconds * 1000).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Copy>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop directions"
        accessibilityHint="Stops navigation without ending your ride"
        onPress={onEnd}
        style={({ pressed }) => [styles.end, pressed && styles.pressed]}
      >
        <Copy style={styles.icon}>×</Copy>
        <Copy style={styles.label}>End</Copy>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: 20,
    borderRadius: 28,
    backgroundColor: 'rgba(18,18,18,0.94)',
    borderWidth: 1,
    borderColor: theme.glassHighlight,
  },
  estimate: { flexGrow: 1, flexShrink: 1, gap: 4 },
  time: { fontFamily: 'Manrope_700Bold', fontSize: 28, lineHeight: 36, color: theme.gold },
  detail: { fontSize: 14, lineHeight: 22, color: theme.text },
  end: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: theme.glassHighlight,
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.14)' },
  icon: { color: theme.danger, fontSize: 25, lineHeight: 28 },
  label: { fontFamily: 'Manrope_700Bold', fontSize: 16, lineHeight: 24 },
});
