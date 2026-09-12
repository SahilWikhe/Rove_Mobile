import { useSession } from '@rove/mobile-core/session';
import { useMessageUnread } from '@rove/mobile-core/use-messages';
import { useFocusEffect } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Copy, theme } from '@rove/mobile-ui';
import { messageIcon } from '@rove/mobile-ui/message-icon';
import drive from '../../assets/navigation/drive.png';
import trips from '../../assets/navigation/trips.png';
import earnings from '../../assets/navigation/earnings.png';
import account from '../../assets/navigation/account.png';

const destinations = [
  { label: 'Drive', path: '/drive', icon: drive },
  { label: 'Trips', path: '/trips', icon: trips },
  { label: 'Earnings', path: '/earnings', icon: earnings },
  { label: 'Messages', path: '/messages', icon: messageIcon },
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
  const { api, profile } = useSession();
  const messages = useMessageUnread(api, profile?.id);
  useFocusEffect(messages.focus);
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        {destinations.map(({ label, path, icon }) => (
          <Pressable
            key={path}
            accessibilityRole="button"
            accessibilityLabel={
              label === 'Messages' && messages.unread ? `Messages, ${messages.unread} unread` : label
            }
            accessibilityState={{ selected: path === active, disabled }}
            disabled={disabled}
            onPress={() => {
              if (path !== active) router.replace(path);
            }}
            style={({ pressed }) => [styles.item, (pressed || disabled) && styles.dimmed]}
          >
            {label === 'Messages' && messages.unread > 0 && (
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 8,
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: theme.gold,
                }}
              />
            )}
            <Image
              source={icon}
              accessible={false}
              style={[styles.icon, { tintColor: path === active ? theme.gold : theme.muted }]}
            />
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
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    gap: 4,
    padding: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(12,12,12,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  item: { minWidth: 48, flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
  icon: { width: 24, height: 24 },
  label: { color: theme.muted, fontSize: 11, lineHeight: 16 },
  dimmed: { opacity: 0.6 },
});
