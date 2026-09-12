import { useCallback, useRef, useState } from 'react';
import { AppState, PixelRatio, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestForegroundPermissionsAsync } from 'expo-location';
import {
  CameraPerspective,
  NavigationProvider,
  NavigationView,
  NavigationNightMode,
  NavigationSessionStatus,
  RouteStatus,
  TaskRemovedBehavior,
  TravelMode,
  useNavigation,
  type NavigationViewController,
} from '@googlemaps/react-native-navigation-sdk';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Copy, Screen, theme } from '@rove/mobile-ui';
import { createGuidance, assertNavigationActive, type Target } from './guidance';
import { navigationTarget } from './directions';
import { navigationFailure } from './errors';
import { GuidanceFooter } from './guidance-footer';

// Optional cloud styling. Unconfigured builds retain Google's default navigation map.
const navigationMapId =
  (Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_GOOGLE_NAVIGATION_IOS_MAP_ID
    : process.env.EXPO_PUBLIC_GOOGLE_NAVIGATION_ANDROID_MAP_ID
  )?.trim() || undefined;

const terms = { title: 'Navigation terms', companyName: 'Rove', showOnlyDisclaimer: false };
// SDK session is process-wide. A new screen waits for its predecessor's pending native cleanup.
let teardown: Promise<void> = Promise.resolve();
export default function NavigationScreen() {
  const { profile } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <NavigationProvider
      termsAndConditionsDialogOptions={terms}
      taskRemovedBehavior={TaskRemovedBehavior.QUIT_SERVICE}
    >
      <Directions key={`${profile?.id}:${id}`} id={id} />
    </NavigationProvider>
  );
}
function Directions({ id }: { id: string }) {
  const { api, profile } = useSession();
  const { navigationController: controller, setOnLocationChanged, setOnArrival } = useNavigation();
  const readEstimate = useCallback(() => controller.getCurrentTimeAndDistance(), [controller]);
  const insets = useSafeAreaInsets();
  const [topOverlayHeight, setTopOverlayHeight] = useState(64);
  const [bottomOverlayHeight, setBottomOverlayHeight] = useState(88);
  // Android Maps consumes physical pixels; iOS consumes UIKit points.
  const mapScale = Platform.OS === 'android' ? PixelRatio.get() : 1;
  const view = useRef<NavigationViewController | null>(null);
  const session = useRef<ReturnType<typeof createGuidance> | null>(null);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const focused = useRef(false);
  const prompting = useRef(false);
  const stop = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (current) teardown = current.dispose().catch(() => undefined);
    setRunning(false);
    setBusy(false);
  }, []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'background' && !prompting.current) {
          stop();
          setMessage('Directions paused. Start again when you return.');
        }
      });
      return () => {
        focused.current = false;
        sub.remove();
        stop();
      };
    }, [stop]),
  );
  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      const request = new AbortController();
      setReady(false);
      setPreview(null);
      void api
        .ride(id, request.signal)
        .then((ride) => {
          if (request.signal.aborted) return;
          const next = ride.id === id ? navigationTarget(ride) : null;
          if (!next) throw new Error('Directions are not available for this trip.');
          setPreview(next);
        })
        .catch((error) => {
          if (!request.signal.aborted)
            setMessage(error instanceof Error ? error.message : 'Trip information is unavailable.');
        });
      return () => request.abort();
    }, [api, id, profile]),
  );
  const start = async () => {
    if (!profile || session.current || !ready || !focused.current) return;
    setBusy(true);
    setMessage(null);
    const previous = teardown;
    const current = createGuidance({
      load: async (signal) => {
        const ride = await api.ride(id, signal);
        if (ride.id !== id) throw new Error('Trip information could not be verified.');
        return ride;
      },
      prepare: async (signal) => {
        await previous;
        assertNavigationActive(signal);
        // Android permission/SDK dialogs temporarily background the host activity.
        // Revalidate immediately after the prompt instead of cancelling that user action.
        prompting.current = true;
        try {
          if (!(await requestForegroundPermissionsAsync()).granted)
            throw new Error('Allow location access to use turn-by-turn directions.');
          assertNavigationActive(signal);
          if (!(await controller.showTermsAndConditionsDialog()))
            throw new Error('Accept the navigation terms to start directions.');
        } finally {
          prompting.current = false;
        }
        assertNavigationActive(signal);
        if (!focused.current || AppState.currentState === 'background')
          throw new Error('Directions paused. Start again when you return.');
        let located = false;
        setOnLocationChanged(() => {
          located = true;
        });
        const status = await controller.init();
        assertNavigationActive(signal);
        if (status !== NavigationSessionStatus.OK) throw new Error(navigationFailure(String(status)));
        controller.startUpdatingLocation();
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timeout);
            clearInterval(timer);
            signal.removeEventListener('abort', cancelled);
            setOnLocationChanged(null);
            if (error) reject(error);
            else resolve();
          };
          const cancelled = () => finish(new Error('Navigation cancelled.'));
          const timeout = setTimeout(
            () => finish(new Error('Waiting for your location. Check location access and try again.')),
            20000,
          );
          const timer = setInterval(() => {
            if (located) finish();
          }, 200);
          signal.addEventListener('abort', cancelled, { once: true });
          if (signal.aborted) cancelled();
        });
      },
      route: async (target) => {
        const result = await controller.setDestinations(
          [
            {
              title: target.leg === 'pickup' ? 'Pickup' : 'Destination',
              position: { lat: target.coordinate.latitude, lng: target.coordinate.longitude },
            },
          ],
          { routingOptions: { travelMode: TravelMode.DRIVING } },
        );
        if (result !== RouteStatus.OK) throw new Error(navigationFailure(String(result)));
      },
      start: async () => {
        await view.current?.setNavigationUIEnabled(true);
        await controller.startGuidance();
        await view.current?.setFollowingPerspective(CameraPerspective.TILTED);
      },
      stop: () => controller.stopGuidance(),
      cleanup: async () => {
        setOnLocationChanged(null);
        setOnArrival(null);
        controller.stopUpdatingLocation();
        try {
          await controller.clearDestinations();
        } finally {
          await controller.cleanup();
        }
      },
    });
    session.current = current;
    setOnArrival(() => {
      stop();
      setMessage('You’ve reached the stop. Return to the trip to confirm the next step.');
    });
    try {
      await current.start();
      if (session.current !== current) return;
      setRunning(true);
    } catch (error) {
      if (session.current === current) {
        stop();
        setMessage(error instanceof Error ? error.message : 'Directions are unavailable.');
      }
    } finally {
      if (session.current === current) setBusy(false);
    }
  };
  useFocusEffect(
    useCallback(() => {
      if (!running) return;
      let checking = false;
      const timer = setInterval(async () => {
        const current = session.current;
        if (!current || checking) return;
        checking = true;
        try {
          await current.validate();
        } catch {
          if (session.current === current) {
            stop();
            setMessage(
              'Directions paused because the trip could not be verified. Return to the trip and try again.',
            );
          }
        } finally {
          checking = false;
        }
      }, 4000);
      return () => clearInterval(timer);
    }, [running, stop]),
  );
  if (!profile)
    return (
      <Screen>
        <Copy>Sign in to view directions.</Copy>
      </Screen>
    );
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {preview ? (
        <NavigationView
          {...(navigationMapId ? { mapId: navigationMapId } : {})}
          initialCameraPosition={{
            target: { lat: preview.coordinate.latitude, lng: preview.coordinate.longitude },
            zoom: 15,
          }}
          style={StyleSheet.absoluteFill}
          mapPadding={{
            top: (insets.top + topOverlayHeight) * mapScale,
            bottom: (insets.bottom + bottomOverlayHeight) * mapScale,
            left: insets.left * mapScale,
            right: insets.right * mapScale,
          }}
          footerEnabled={false}
          navigationNightMode={NavigationNightMode.FORCE_NIGHT}
          onMapReady={() => setReady(true)}
          onNavigationViewControllerCreated={(value) => {
            view.current = value;
          }}
        />
      ) : (
        <View style={styles.loading}>
          <Copy>{message ? 'Return to your trip to try again.' : 'Loading trip map…'}</Copy>
        </View>
      )}
      <View
        pointerEvents="box-none"
        style={[
          styles.topOverlay,
          { top: insets.top + (running ? 200 : 0), left: insets.left, right: insets.right },
        ]}
        onLayout={(event) => setTopOverlayHeight(event.nativeEvent.layout.height)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to trip"
          accessibilityHint="Stops directions and returns to your trip"
          onPress={() => {
            stop();
            router.back();
          }}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <View accessible={false} style={styles.chevron} />
        </Pressable>
        {message && <Banner message={message} />}
      </View>
      <View
        pointerEvents="box-none"
        style={[styles.bottomOverlay, { bottom: insets.bottom, left: insets.left, right: insets.right }]}
        onLayout={(event) => setBottomOverlayHeight(event.nativeEvent.layout.height)}
      >
        {running ? (
          <GuidanceFooter readEstimate={readEstimate} onEnd={stop} />
        ) : (
          <Button title="Start directions" loading={busy} disabled={!ready} onPress={() => void start()} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topOverlay: { position: 'absolute', padding: 12, gap: 10 },
  bottomOverlay: { position: 'absolute', padding: 16 },
  back: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,12,0.72)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  backPressed: { backgroundColor: 'rgba(35,35,35,0.92)' },
  chevron: {
    width: 11,
    height: 11,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: theme.text,
    transform: [{ translateX: 2 }, { rotate: '45deg' }],
  },
});
