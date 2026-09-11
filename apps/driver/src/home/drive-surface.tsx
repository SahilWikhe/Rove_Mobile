import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Copy, Screen, theme } from '@rove/mobile-ui';
import { WaitingMap } from './waiting-map';

/** Figma 1:62: map above an accessible scrolling sheet; no mock roads or driver positions. */
export function DriveSurface({
  online,
  synthetic,
  footer,
  children,
}: PropsWithChildren<{
  online: boolean;
  synthetic: boolean;
  footer: ReactNode;
}>) {
  const { height } = useWindowDimensions();
  if (!online)
    return (
      <Screen contentStyle={{ paddingTop: 20, gap: 16 }} footer={footer}>
        {children}
      </Screen>
    );
  return (
    <SafeAreaView style={styles.screen}>
      <View style={{ height: Math.max(240, Math.min(440, height * 0.43)) }}>
        <WaitingMap synthetic={synthetic} />
        <View style={styles.status} pointerEvents="none">
          <Copy style={styles.statusText}>You’re online · looking for rides</Copy>
        </View>
      </View>
      <ScrollView
        style={styles.sheet}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  status: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(18,18,18,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(214,178,109,0.45)',
  },
  statusText: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: theme.text },
  sheet: {
    flex: 1,
    backgroundColor: theme.raised,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  content: { padding: 20, gap: 14, paddingBottom: 24 },
});
