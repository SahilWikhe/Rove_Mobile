import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder } from 'react-native';
import { useReducedMotion } from '@rove/mobile-core/use-reduced-motion';

export function useDriveSheet(travel: number) {
  const [progress] = useState(() => new Animated.Value(0));
  const [expanded, setExpanded] = useState(false);
  const position = useRef(0);
  const origin = useRef(0);
  const scrollY = useRef(0);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const listener = progress.addListener(({ value }) => {
      position.current = value;
    });
    return () => {
      progress.removeListener(listener);
      progress.stopAnimation();
    };
  }, [progress]);
  const settle = (target: number) => {
    setExpanded(target === 1);
    progress.stopAnimation();
    if (reducedMotion) progress.setValue(target);
    else
      Animated.spring(progress, {
        toValue: target,
        useNativeDriver: false,
        stiffness: 240,
        damping: 30,
        mass: 1,
        overshootClamping: true,
      }).start();
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          Math.abs(gesture.dy) > 10 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.3 &&
          ((gesture.dy < 0 && position.current < 0.99) ||
            (gesture.dy > 0 && scrollY.current <= 1 && position.current > 0.01)),
        onPanResponderGrant: () => {
          progress.stopAnimation();
          origin.current = position.current;
        },
        onPanResponderMove: (_, gesture) =>
          progress.setValue(Math.max(0, Math.min(1, origin.current - gesture.dy / travel))),
        onPanResponderRelease: (_, gesture) => {
          const target =
            Math.abs(gesture.vy) > 0.35 ? (gesture.vy < 0 ? 1 : 0) : position.current >= 0.5 ? 1 : 0;
          setExpanded(target === 1);
          if (reducedMotion) progress.setValue(target);
          else
            Animated.spring(progress, {
              toValue: target,
              useNativeDriver: false,
              stiffness: 240,
              damping: 30,
              mass: 1,
              overshootClamping: true,
            }).start();
        },
        onPanResponderTerminate: () => {
          const target = position.current >= 0.5 ? 1 : 0;
          setExpanded(target === 1);
          progress.setValue(target);
        },
      }),
    [progress, travel, reducedMotion],
  );
  return {
    progress,
    expanded,
    scrollY,
    panHandlers: responder.panHandlers,
    toggle: () => settle(expanded ? 0 : 1),
  };
}
