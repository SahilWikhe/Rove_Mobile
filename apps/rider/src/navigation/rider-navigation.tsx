import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Copy, theme } from '@rove/mobile-ui';
import ride from '../../assets/home/ride.png';
import rides from '../../assets/home/rides.png';
import account from '../../assets/home/account.png';
const assets = { ride, rides, account };

export function HomeNavigation({
  active = '/',
  disabled = false,
}: {
  active?: '/' | '/account' | '/rides';
  disabled?: boolean;
}) {
  return (
    <View style={styles.navigationWrap}>
      <View style={styles.navigation}>
        {(
          [
            { label: 'Ride', icon: assets.ride, path: '/' },
            { label: 'My rides', icon: assets.rides, path: '/rides' },
            { label: 'Account', icon: assets.account, path: '/account' },
          ] as const
        ).map(({ label, icon, path }) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: path === active, disabled }}
            disabled={disabled}
            onPress={() => {
              if (path !== active) router.replace(path);
            }}
            style={({ pressed }) => [styles.navItem, (pressed || disabled) && styles.pressed]}
          >
            <Image
              source={icon}
              style={[styles.icon, { tintColor: path === active ? theme.gold : theme.muted }]}
              accessible={false}
            />
            <Copy style={[styles.navLabel, path === active && { color: theme.gold }]}>{label}</Copy>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  navigationWrap: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  navigation: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(18,18,18,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    padding: 8,
  },
  navItem: {
    minHeight: 54,
    minWidth: 76,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  icon: { width: 24, height: 24 },
  navLabel: { color: theme.muted, fontSize: 11, lineHeight: 16 },
  pressed: { opacity: 0.75 },
});
