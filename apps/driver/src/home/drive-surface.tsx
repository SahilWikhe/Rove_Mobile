import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Copy, Screen, theme } from '@rove/mobile-ui';
import { useDriveSheet } from './use-drive-sheet';
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
  const collapsedHeight =
    (request ? Math.max(140, Math.min(260, height * 0.28)) : Math.max(240, Math.min(440, height * 0.43))) +
    insets.top;
  const expandedHeight = Math.min(collapsedHeight - 40, insets.top + 100);
  const sheet = useDriveSheet(collapsedHeight - expandedHeight);
  const [visibleMapHeight, setVisibleMapHeight] = useState(collapsedHeight);
  if (!online)
    return (
      <Screen floatingFooter contentStyle={{ paddingTop: 20, gap: 16 }} footer={footer}>
        {children}
      </Screen>
    );
  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <View style={StyleSheet.absoluteFill}>
        <WaitingMap synthetic={synthetic} bottomInset={Math.max(0, height - visibleMapHeight)} />
      </View>
      <Animated.View
        testID="drive-map-area"
        pointerEvents="box-none"
        onLayout={(event) => setVisibleMapHeight(event.nativeEvent.layout.height)}
        style={{
          height: sheet.progress.interpolate({
            inputRange: [0, 1],
            outputRange: [collapsedHeight, expandedHeight],
          }),
          overflow: 'hidden',
        }}
      >
        <View style={[styles.status, { top: insets.top + 20 }]} pointerEvents="none">
          <Copy style={styles.statusText}>
            {request ? 'Ride request · your location' : 'You’re online · looking for rides'}
          </Copy>
        </View>
      </Animated.View>
      <View
        style={[styles.sheet, { marginBottom: insets.bottom + (footer ? footerHeight + 8 : 12) }]}
        {...sheet.panHandlers}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sheet.expanded ? 'Collapse driving panel' : 'Expand driving panel'}
          accessibilityHint="Drag up or down to resize the panel and map."
          accessibilityState={{ expanded: sheet.expanded }}
          onPress={sheet.toggle}
          style={styles.handleTarget}
        >
          <View style={styles.handle} />
        </Pressable>
        <ScrollView
          style={{ flex: 1 }}
          scrollEnabled={sheet.expanded}
          onScroll={(event) => {
            sheet.scrollY.current = Math.max(0, event.nativeEvent.contentOffset.y);
          }}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
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
    marginHorizontal: 12,
    marginTop: 12,
    backgroundColor: 'rgba(10,10,10,0.96)',
    borderRadius: 28,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  handleTarget: { height: 48, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 44, height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.3)' },
  content: { padding: 20, paddingTop: 0, gap: 14, paddingBottom: 24 },
});
