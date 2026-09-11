import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Copy, Screen, theme } from '@rove/mobile-ui';
import { WaitingMap } from './waiting-map';

/** Figma 1:62: map above an accessible scrolling sheet; no mock roads or driver positions. */
export function DriveSurface({
  online,
  synthetic,
  footer,
  children,
  request = false,
}: PropsWithChildren<{
  online: boolean;
  synthetic: boolean;
  footer?: ReactNode;
  request?: boolean;
}>) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(90);
  if (!online)
    return (
      <Screen floatingFooter contentStyle={{ paddingTop: 20, gap: 16 }} footer={footer}>
        {children}
      </Screen>
    );
  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <View
        style={{
          height:
            (request
              ? Math.max(140, Math.min(260, height * 0.28))
              : Math.max(240, Math.min(440, height * 0.43))) + insets.top,
        }}
      >
        <WaitingMap synthetic={synthetic} />
        <View style={[styles.status, { top: insets.top + 20 }]} pointerEvents="none">
          <Copy style={styles.statusText}>
            {request ? 'Ride request · your location' : 'You’re online · looking for rides'}
          </Copy>
        </View>
      </View>
      <ScrollView
        style={styles.sheet}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: (footer ? footerHeight + 16 : 24) + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer && (
        <View
          pointerEvents="box-none"
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
          style={{
            position: 'absolute',
            left: insets.left,
            right: insets.right,
            bottom: insets.bottom,
            zIndex: 10,
          }}
        >
          {footer}
        </View>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  status: {
    position: 'absolute',
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
