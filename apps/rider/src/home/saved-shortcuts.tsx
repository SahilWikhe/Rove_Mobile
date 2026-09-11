import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { SavedPlaceKind } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { pollWhileForeground } from '@rove/mobile-core/foreground-polling';
import { Copy, theme } from '@rove/mobile-ui';

/** The parent Home is keyed by account; only slot names, never addresses, are loaded here. */
export function SavedShortcuts() {
  const { api } = useSession();
  const [saved, setSaved] = useState<SavedPlaceKind[] | null>(null);
  const [failed, setFailed] = useState(false);
  useFocusEffect(
    useCallback(
      () =>
        pollWhileForeground({
          load: (signal) => api.savedPlaces(signal),
          onData: ({ places }) => {
            setSaved(places.map((place) => place.kind));
            setFailed(false);
          },
          onError: () => {
            setSaved(null);
            setFailed(true);
          },
          intervalMs: 30_000,
        }),
      [api],
    ),
  );
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {(['home', 'work'] as const).map((kind) => {
          const label = kind === 'home' ? 'Home' : 'Work';
          const exists = saved?.includes(kind);
          return (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityLabel={exists ? `Go to ${label}` : `Set up ${label}`}
              accessibilityState={{ disabled: saved === null }}
              disabled={saved === null}
              onPress={() =>
                router.push(exists ? { pathname: '/book', params: { savedKind: kind } } : '/saved-places')
              }
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 72,
                padding: 14,
                gap: 4,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.raised,
                opacity: pressed || saved === null ? 0.6 : 1,
              })}
            >
              <Copy style={{ color: theme.gold, fontSize: 15, fontFamily: 'Manrope_700Bold' }}>{label}</Copy>
              <Copy kind="muted" style={{ fontSize: 12 }}>
                {saved === null
                  ? failed
                    ? 'Unavailable'
                    : 'Loading…'
                  : exists
                    ? 'Saved destination'
                    : 'Add a place'}
              </Copy>
            </Pressable>
          );
        })}
      </View>
      {failed && (
        <Copy kind="muted">Saved places couldn’t be loaded. You can still search for a destination.</Copy>
      )}
    </View>
  );
}
