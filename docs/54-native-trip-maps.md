# Native trip maps

Rider ride details and driver accepted-trip details now share an endpoint map. It renders only when the authorized ride response contains both precise endpoints. The driver offer screen has no map import or exact endpoint markers; after the assignment ends, the driver's response omits those endpoints and the map is removed.

The native implementation uses the Expo SDK's compatible `react-native-maps` version, 1.27.2. It shows labeled pickup/destination markers, retains the map provider's attribution and provides the existing textual route below. It does not request another location permission, draw a guessed route polyline, fabricate a driver marker or imply an ETA. Actual rider-visible driver tracking still requires an assignment-authorized read API and freshness handling.

## Providers and configuration

Production iOS and Android use Google Maps because the backend's production place provider is Google. Google's [Places display policy](https://developers.google.com/maps/documentation/places/web-service/policies) requires Google-derived place results shown on a map to use a Google Map. Synthetic iOS sessions can use Apple Maps with fake endpoints. Synthetic Android maps still need a configured Maps SDK key. The web build uses an explicit native-map availability message, never a fake interactive map.

Both apps have a dynamic Expo config that preserves `app.json` and adds the maps config plugin. Configure separate restricted client keys for each app/platform:

- `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`: Maps SDK for Android; restrict to `co.roveride.rider` or `co.roveride.driver` and the correct signing certificate SHA-1 fingerprints.
- `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`: Maps SDK for iOS; restrict to the corresponding bundle identifier.

These keys are client-visible SDK configuration, not backend Places/Routes credentials. Never put server keys in these variables. Enable the corresponding SDKs, configure billing/quotas and key restrictions in Google Cloud, then rebuild the native apps. Updating JavaScript alone does not install SDK credentials or native modules. See [Expo's setup instructions](https://docs.expo.dev/versions/latest/sdk/map-view/).

Without the required platform key, the map view is replaced with a clear configuration message; textual route details and trip actions remain available. Presence of a key does not prove it is valid: provider rendering and restrictions must be tested with real configured builds before release. No provider account or billing was changed by this implementation.

## Verification boundaries

Type checking, native/web exports and the browser trip journey verify package boundaries and web fallback behavior. Simulator native compilation verifies linking of the added module. Physical Android/iOS checks, configured production Google Maps rendering, accessibility and gesture checks, offline map behavior, complete Figma tracking composition, route geometry and live location remain release work. A map with endpoint pins is not a completed navigation or tracking feature.

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
