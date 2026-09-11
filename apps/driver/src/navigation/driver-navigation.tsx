import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Copy, theme } from '@rove/mobile-ui';
import drive from '../../assets/navigation/drive.png';
import trips from '../../assets/navigation/trips.png';
import earnings from '../../assets/navigation/earnings.png';
import account from '../../assets/navigation/account.png';

const destinations = [
  { label: 'Drive', path: '/drive', icon: drive },
  { label: 'Trips', path: '/trips', icon: trips },
  { label: 'Earnings', path: '/earnings', icon: earnings },
  { label: 'Account', path: '/account', icon: account },
] as const;

/** Figma driver tab bar 4:281, with approved scheduling/messaging scope. */
export function DriverNavigation({
  active,
  disabled = false,
}: {
  active: (typeof destinations)[number]['path'];
  disabled?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        {destinations.map(({ label, path, icon }) => (
          <Pressable
            key={path}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: path === active, disabled }}
            disabled={disabled}
            onPress={() => {
              if (path !== active) router.replace(path);
            }}
            style={({ pressed }) => [styles.item, (pressed || disabled) && styles.dimmed]}
          >
            <Image source={icon} accessible={false} style={styles.icon} />
            <Copy style={[styles.label, path === active && { color: theme.gold }]}>{label}</Copy>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  bar: {
    flexDirection: 'row',
    gap: 4,
    padding: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(18,18,18,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  item: { minWidth: 60, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
  icon: { width: 24, height: 24 },
  label: { color: theme.muted, fontSize: 11, lineHeight: 16 },
  dimmed: { opacity: 0.6 },
});
