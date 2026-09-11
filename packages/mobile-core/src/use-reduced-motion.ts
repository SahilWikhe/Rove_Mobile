import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { observeMotionPreference } from './motion-preference';

export function useReducedMotion() {
  // Avoid motion until the device preference has been confirmed.
  const [reduced, setReduced] = useState(true);
  useEffect(
    () =>
      observeMotionPreference(
        {
          read: () => AccessibilityInfo.isReduceMotionEnabled(),
          subscribe: (listener) => {
            const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', listener);
            return () => subscription.remove();
          },
        },
        setReduced,
      ),
    [],
  );
  return reduced;
}
