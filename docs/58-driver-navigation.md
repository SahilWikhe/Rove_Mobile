# Driver in-app navigation

The active driver trip offers **Directions to pickup** while matched, approaching or waiting,
and **Directions to destination** while in progress. Completed, cancelled, searching and
interrupted trips offer no navigation action. Directions open inside the native driver app.
Browser builds explain that turn-by-turn directions require the iOS or Android app.

## Authorization and lifecycle

Each explicit tap reads the owned trip again through the authenticated ride endpoint.
A failed read never falls back to cached coordinates. A different trip, older version, missing
endpoint, ended trip, changed leg or changed coordinate prevents opening directions and asks
the driver to check the updated trip. A newer version with the same leg and endpoint remains usable.

A pending screen launch is cancelled on blur, unmount, background, account/trip/version replacement
or disabled controls. Duplicate taps share the busy guard. Uncertain trip operations and read
errors disable navigation until resolved. Late responses cannot launch a cancelled screen.

Starting guidance requests location permission and displays Google's navigation notice. Trip
ownership and the selected leg are checked again after preparation and after route calculation.
A route failure stops the session; retry creates a fresh session and reads the current trip.
Pending native work is stopped again after it settles so a late start cannot survive teardown.

While running, guidance checks the trip every four seconds. Losing access, changing the leg,
ending the trip, leaving the screen or backgrounding the app stops the session. This is periodic
validation, not instantaneous server revocation. Continuous background/lock-screen guidance is
still outstanding. Opening directions or reaching an SDK waypoint does not record arrival,
start the trip or complete it; these remain explicit trip-screen actions.

## Provider setup and privacy

The internal route contains only the trip ID. The Navigation SDK receives the authorized stop's
coordinates and uses device location for guidance. It does not receive rider identity, address
labels, access tokens or payment data from this screen. Google displays its navigation data notice
before first use. Navigation uses Google's billing even with a synthetic ride backend.

See [native SDK configuration](54-native-trip-maps.md#in-app-driver-navigation) for API-key
restrictions, native dependency versions, reproducible build configuration and upgrade requirements.
The backend Places/Routes key does not configure native Navigation SDK access.

## Verification scope

- Controller tests cover authorization, changed/ended trips, stale endpoints, preparation failure,
  routing failure, retry with a new trip leg and late native completion after cancellation.
- The two-app browser test verifies internal navigation, no external window and unchanged trip
  milestones. It does not calculate a Google route.
- `native-smoke/driver-navigation.yaml` verifies screen entry and return on an active pickup trip.
  It deliberately does not acknowledge the provider notice or calculate a route.
- Actual route display, spoken guidance, rerouting, repeated starts/stops and physical-device GPS
  remain native release checks. A successful build or screen-entry smoke test does not prove them.

## Optional cloud navigation map theme

The driver navigation view accepts platform-specific cloud map IDs through
`EXPO_PUBLIC_GOOGLE_NAVIGATION_IOS_MAP_ID` and
`EXPO_PUBLIC_GOOGLE_NAVIGATION_ANDROID_MAP_ID`. These are public map identifiers,
not API keys. Empty values omit the SDK property and retain the default map.
This wiring alone does not create a cloud style or prove its rendered appearance.

To activate later:

1. In the Rove Google Cloud project, create and publish a cloud map style with a
   dark navigation variant. Match the existing charcoal background and muted gold
   roads while preserving road visibility, readable labels and navigation contrast.
2. Associate that style with an iOS map ID and an Android map ID. Enable its
   navigation map type as well as road map type; the app forces night navigation.
3. Set the two public environment variables in the driver app build environment,
   then rebuild/export the app bundle. Setting Vercel backend variables alone does
   not configure an already-built mobile app.
4. Verify actual guidance on both platforms, including route contrast, lane guidance,
   traffic colors, labels and attribution. Published appearance is not yet verified.
5. Remove the variables and rebuild to restore default styling.

Google currently describes this as a Preview feature and charges map-ID loads
against the Dynamic Maps SKU. No cloud map IDs or paid styling loads were created
by adding this configuration. See Google's
[iOS styling guide](https://developers.google.com/maps/documentation/navigation/ios-sdk/customize-map-styles)
and [Android styling guide](https://developers.google.com/maps/documentation/navigation/android-sdk/customize-map-styles).
