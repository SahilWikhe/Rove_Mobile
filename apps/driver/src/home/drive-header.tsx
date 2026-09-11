import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Copy, theme } from '@rove/mobile-ui';

/** Figma driver 1:12: compact brand, account badge, greeting and availability pill. */
export function DriveHeader({
  name,
  online,
  activeTrip = false,
}: {
  name: string;
  online: boolean | null;
  activeTrip?: boolean;
}) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toLocaleUpperCase();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <View style={styles.content}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <Copy style={styles.wordmark}>rove</Copy>
          <Copy style={styles.driver}>· driver</Copy>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your account"
          onPress={() => router.push('/account')}
          style={styles.accountTarget}
        >
          <View style={styles.avatar}>
            <Copy style={styles.initials}>{initials || 'R'}</Copy>
          </View>
        </Pressable>
      </View>
      <Copy style={styles.greeting}>
        {greeting}
        {words[0] ? `, ${words[0]}` : ''}
      </Copy>
      <View style={[styles.status, online && styles.online]}>
        <Copy style={[styles.statusText, online && { color: theme.text }]}>
          {online === null
            ? 'Checking availability…'
            : online
              ? activeTrip
                ? 'You’re online · trip active'
                : 'You’re online · looking for rides'
              : 'You’re offline'}
        </Copy>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  wordmark: { fontFamily: 'Manrope_800ExtraBold', fontSize: 19, lineHeight: 26, letterSpacing: -0.38 },
  driver: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: theme.gold },
  accountTarget: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: theme.gold },
  greeting: { fontFamily: 'Manrope_800ExtraBold', fontSize: 26, lineHeight: 34, letterSpacing: -0.52 },
  status: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  online: { borderColor: 'rgba(214,178,109,0.45)' },
  statusText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, lineHeight: 18, color: theme.muted },
});
