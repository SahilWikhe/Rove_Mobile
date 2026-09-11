# Native trip maps

Rider ride details and driver accepted-trip details now share an endpoint map. It renders only when the authorized ride response contains both precise endpoints. The driver offer screen has no map import or exact endpoint markers; after the assignment ends, the driver's response omits those endpoints and the map is removed.

The native implementation uses the Expo SDK's compatible `react-native-maps` version, 1.27.2. It shows labeled pickup/destination markers, retains the map provider's attribution and provides the existing textual route below. It does not request another location permission, draw a guessed route polyline, fabricate a driver marker or imply an ETA. Rider-visible location now uses the assignment-authorized API and freshness handling described in [live driver location](55-live-driver-location.md).

## Providers and configuration

Production iOS and Android use Google Maps because the backend's production place provider is Google. Google's [Places display policy](https://developers.google.com/maps/documentation/places/web-service/policies) requires Google-derived place results shown on a map to use a Google Map. Synthetic iOS sessions use Google Maps when an iOS SDK key is configured; otherwise they can use Apple Maps with fake endpoints. Synthetic Android maps still need a configured Maps SDK key. The web build uses an explicit native-map availability message, never a fake interactive map.

Both apps have a dynamic Expo config that preserves `app.json` and adds the maps config plugin. Configure separate restricted client keys for iOS and Android. Each platform key can authorize both app identifiers; release signing restrictions must be added separately:

- `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`: Maps SDK for Android; restrict to `co.roveride.rider` or `co.roveride.driver` and the correct signing certificate SHA-1 fingerprints.
- `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`: Maps SDK for iOS; restrict to the corresponding bundle identifier.

These keys are client-visible SDK configuration, not backend Places/Routes credentials. Never put server keys in these variables. Enable the corresponding SDKs, configure billing/quotas and key restrictions in Google Cloud, then rebuild the native apps. Updating JavaScript alone does not install SDK credentials or native modules. See [Expo's setup instructions](https://docs.expo.dev/versions/latest/sdk/map-view/).

Without the required platform key, the map view is replaced with a clear configuration message; textual route details and trip actions remain available. Presence of a key does not prove it is valid: provider rendering and restrictions must be tested with real configured builds before release. No provider account or billing was changed by this implementation.

## Verification boundaries

Type checking, native/web exports and the browser trip journey verify package boundaries and web fallback behavior. Simulator native compilation verifies linking of the added module. Physical Android/iOS checks, configured production Google Maps rendering, accessibility and gesture checks, offline map behavior, complete Figma tracking composition, route geometry and physical-device live location remain release work. A map with endpoint pins is not a completed navigation or tracking feature.

## Local native smoke test

`native-smoke/trip-map.yaml` is a parameterized Maestro flow for an already installed, signed-in synthetic app and an accepted synthetic trip. It opens the trip deep link, handles iOS's optional Open confirmation, asserts the trip heading/map caption and saves a screenshot. It does not create a ride, sign into a real account or mutate payments.

With Maestro 2.10.0, Java 21, Xcode and the running local Metro/API environment:

```sh
MAESTRO_CLI_NO_ANALYTICS=1 maestro test \
  -e APP_ID=co.roveride.rider \
  -e TRIP_LINK="rove-rider://ride?id=$RIDE_ID" \
  -e EXPECTED_TITLE='Your driver is confirmed.' \
  native-smoke/trip-map.yaml
```

For the driver, use app ID `co.roveride.driver`, link `rove-driver://trip?id=$RIDE_ID` and heading `Let’s get there.` while the assigned trip is matched. Use a synthetic ride owned by the logged-in rider and accepted by the logged-in driver. The smoke test is currently a local check, not a required GitHub job; the browser workflow remains independent. Maestro's assertions check visible UI, while screenshot inspection is needed to verify actual tiles/pins and attribution. Do not put real rider data in test artifacts.

Both Debug apps compiled and installed on iPhone 17 Pro / iOS 26.5. The Maestro flow passed for the rider and driver against the same accepted synthetic trip. Manual screenshot inspection confirmed endpoint pins, map tiles and Apple attribution: [rider](screenshots/rider-native-trip-map.png), [driver](screenshots/driver-native-trip-map.png). These are synthetic Apple-map previews, not verification of production Google credentials or Android rendering.

## Configured Google SDK verification — September 11

The rider Debug app rebuilt successfully for iOS and ARM64 Android after generating native
configuration with restricted platform keys. Both installed into the existing simulators. A
disposable local API supplied an accepted synthetic trip; screenshots showed actual Google tiles,
attribution and route endpoint markers on both platforms. These were SDK rendering checks with
fake ride data, not real bookings or Stripe charges. Driver Debug builds also succeeded on both
platforms, and its accepted-trip Maestro flow passed on both. Google attribution and endpoint tiles
were visually confirmed. A shared custom Google palette replaces the light Android map with dark
geometry and readable labels. Android rendering and its map flow passed after this change; iOS screenshot inspection also
confirmed the shared dark palette. Complete Figma tracking layout is still required.

The first iOS map camera could settle before fitting the endpoints. The map now performs one
additional fit after its initial tiles load, then preserves user gestures. Screenshot inspection
confirmed both endpoints in the initial iOS viewport after this change.

A rebuilt iOS Debug app can show “No script URL provided” when its remembered Metro address does
not match the running test server. Confirm the server's `/status` response first. For a deliberate
isolated session, launch with React Native's debug setting (replace the port as appropriate):

```sh
xcrun simctl launch --terminate-running-process booted co.roveride.rider \
  -RCT_jsLocation 127.0.0.1:8090
```

This is a local debug override, not a release endpoint or persistent production configuration.
The test Metro must explicitly select the disposable API and synthetic identity mode. Keep the
staging Metro configuration separate, and never copy local SDK keys into tracked native sources.

The server hostname matters: a localhost-only Metro may listen on IPv6 and reject `127.0.0.1`.
Check the exact hostname with `/status` before setting `RCT_jsLocation`; use `localhost:PORT`
when that is the reachable address. Simulator preferences and launch overrides are local debug
settings, not changes to the staging API or release builds.

The reusable simulator command checks Metro before touching the app, then writes the address
through the simulator's own preferences service to the installed app's exact preferences file.
It does not edit generated native code, copy keys or change the API environment:

```sh
node scripts/ios-simulator.mjs rider 8090
node scripts/ios-simulator.mjs driver 8095
```

Replace the ports with the intended running Metro ports (staging uses rider 8087 / driver 8088).
An optional third argument selects a simulator UDID; otherwise exactly one booted device is expected.
Keep Metro running. Reinstalling the app or erasing the simulator may require rerunning the helper.
Using host `defaults`, or a simulator domain without the app's full preferences path, did not update
its cached sandbox settings reliably. The exact-path simulator write restored ordinary driver launch. Both apps then passed the
accepted-trip Maestro flow after a normal termination/relaunch without debug launch arguments.

## Driver waiting map verification

The online waiting surface rendered Google tiles, the shared dark palette, a labeled synthetic
location marker, status pill and scrolling lower panel on iOS and Android. Android completed
waiting → offline → online through the visible controls. Maestro reported a device-offline
exception during cleanup after all assertions completed; the subsequent ADB check showed the
emulator connected. The same iOS waiting → offline → online flow also completed successfully.

Run `native-smoke/driver-waiting.yaml` only against a signed-in, online synthetic driver with no
active trip or offer. Tests mutate local availability, so run the platforms sequentially. Two
foreground simulators sharing one driver can race the heartbeat sequence; a displayed update
warning is not proof that the map SDK failed. Real-device tracking still needs separate testing.
