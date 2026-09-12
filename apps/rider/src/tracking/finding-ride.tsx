import car from '../../assets/finding/car.png';
import inner from '../../assets/finding/inner.png';
import outer from '../../assets/finding/outer.png';
import { AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Copy } from '@rove/mobile-ui';

export function FindingRide({ reconnecting }: { reconnecting: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    let disposed = false;
    let changed = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      changed = true;
      setReduceMotion(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!disposed && !changed) setReduceMotion(value);
      })
      .catch(() => {
        /* Keep motion disabled if the preference cannot be read. */
      });
    const state = AppState.addEventListener('change', (value) => setActive(value === 'active'));
    return () => {
      disposed = true;
      motion.remove();
      state.remove();
    };
  }, []);
  useEffect(() => {
    pulse.setValue(0);
    if (reduceMotion || !active || !focused || reconnecting) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      pulse.setValue(0);
    };
  }, [pulse, reduceMotion, active, focused, reconnecting]);
  return (
    <View style={styles.hero}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.rings}
      >
        <Animated.Image
          source={outer}
          style={[
            styles.outer,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) }],
            },
          ]}
        />
        <Animated.Image
          source={inner}
          style={[
            styles.inner,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.8] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }) }],
            },
          ]}
        />
        <View style={styles.badge}>
          <Image source={car} style={styles.car} />
        </View>
      </View>
      <Copy kind="heading" style={styles.title}>
        {reconnecting ? 'Reconnecting to your ride…' : 'Finding your ride.'}
      </Copy>
      <Copy kind="muted" style={styles.caption}>
        {reconnecting ? 'Waiting for current ride information.' : 'Matching you with a nearby Rove driver'}
      </Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  hero: {
    flexGrow: 1,
    minHeight: 300,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  rings: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  outer: { position: 'absolute', width: 150, height: 150 },
  inner: { position: 'absolute', width: 115, height: 115 },
  badge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
  },
  car: { width: 34, height: 34 },
  title: { fontSize: 19, lineHeight: 27, textAlign: 'center' },
  caption: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
