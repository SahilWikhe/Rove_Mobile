import { Pressable, StyleSheet, View } from 'react-native';
import type { Quote } from '@rove/contracts';
import { Copy, theme } from '@rove/mobile-ui';
export const serviceLabels = { standard: 'Standard', accessible: 'Accessible' } satisfies Record<
  Quote['service'],
  string
>;
const services = ['standard', 'accessible'] as const;
export function ServicePicker({
  value,
  onChange,
}: {
  value: Quote['service'];
  onChange: (service: Quote['service']) => void;
}) {
  return (
    <View style={styles.group}>
      <Copy kind="heading">Choose your ride.</Copy>
      {services.map((service) => (
        <Pressable
          key={service}
          accessibilityRole="radio"
          accessibilityLabel={serviceLabels[service]}
          accessibilityState={{ checked: value === service }}
          aria-checked={value === service}
          onPress={() => {
            if (value !== service) onChange(service);
          }}
          style={({ pressed }) => [
            styles.option,
            value === service && styles.selected,
            pressed && { opacity: 0.8 },
          ]}
        >
          <Copy style={value === service ? { color: theme.gold } : undefined}>
            {serviceLabels[service]}
            {value === service ? ' · Selected' : ''}
          </Copy>
          <Copy kind="muted">
            {service === 'standard'
              ? 'An everyday ride to your destination.'
              : 'Match with a driver eligible for accessible rides.'}
          </Copy>
        </Pressable>
      ))}
      <Copy kind="muted">
        Availability is confirmed during matching. Changing your choice requires a new quote.
      </Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  group: { gap: 12 },
  option: {
    minHeight: 80,
    padding: 18,
    gap: 4,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  selected: { borderColor: theme.gold },
});
