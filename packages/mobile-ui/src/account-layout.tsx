import { Image, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { Card, Copy, theme } from './index';

// Shared geometry from rider Account 9:67 and driver Account 4:106.
export function AccountProfile({
  name,
  subtitle,
  avatar,
}: {
  name: string;
  subtitle: string;
  avatar?: ImageSourcePropType;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toLocaleUpperCase();
  return (
    <Card style={styles.profile}>
      <View
        style={[styles.avatar, avatar ? styles.driverAvatar : undefined]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {avatar ? (
          <Image source={avatar} style={{ width: 56, height: 56 }} accessible={false} />
        ) : (
          <Copy style={styles.initials}>{initials}</Copy>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Copy style={[styles.name, avatar ? { fontSize: 17 } : undefined]}>{name}</Copy>
        <Copy style={styles.subtitle}>{subtitle}</Copy>
      </View>
    </Card>
  );
}
export function AccountRow({
  label,
  detail,
  disabled = false,
  onPress,
  icon,
}: {
  label: string;
  detail?: string;
  disabled?: boolean;
  onPress: () => void;
  icon: ImageSourcePropType;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Copy style={styles.rowLabel}>{label}</Copy>
      {detail && <Copy style={[styles.subtitle, styles.detail]}>{detail}</Copy>}
      <Image source={icon} style={{ width: 16, height: 16 }} accessible={false} />
    </Pressable>
  );
}
export const accountContent = { paddingHorizontal: 20, paddingTop: 30, gap: 16 };
export const accountTitle = {
  fontFamily: 'Manrope_800ExtraBold',
  fontSize: 26,
  lineHeight: 35,
  letterSpacing: -0.52,
};
const styles = StyleSheet.create({
  profile: {
    padding: 18,
    borderRadius: 18,
    borderColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#191919',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#33291C', overflow: 'hidden' },
  detail: { flexShrink: 1, maxWidth: '45%', textAlign: 'right' },
  initials: { fontFamily: 'Manrope_800ExtraBold', fontSize: 17, color: theme.gold },
  name: { fontFamily: 'Manrope_700Bold', fontSize: 16, lineHeight: 23 },
  subtitle: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  row: {
    minHeight: 56,
    paddingHorizontal: 4,
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowLabel: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 15, lineHeight: 22 },
});
