# Booking place suggestions

Rider Figma 4:20 supplies the place-row layout. The app now shows nearby rows before typing, then searches after a 500ms typing pause (minimum three characters). Selecting a result fills the focused endpoint. Search remains available without location permission. No current-location label is substituted for a verified provider place.

Native builds use expo-location foreground access only. Existing permission permits one lookup on screen mount; otherwise the rider taps Suggest places around me. Location acquisition times out after 15 seconds, and failures preserve manual address entry. No background location task or coordinate persistence is added. Synthetic development uses local fixtures instead of device GPS.

POST /v1/places/nearby requires normal authentication, strict Coordinate input and the places rate-limit budget. Google Places API (New) searchNearby uses a fixed 5km circle, distance ranking and five results with the existing limited place field mask. The same server Places key is used. Provider errors fail visibly; no fabricated live results replace them. This is a billable Google capability subject to the account's allowance; staging does not inherently make provider requests free.

Deploy the updated API and rebuild the rider native app to include the location module and permission text. Existing installations cannot obtain a new native module through JavaScript refresh alone. No new key is required if the server key already permits Places API (New). Confirm foreground permission granted/denied, unavailable GPS, nearby result selection and provider restrictions on actual devices before release.

Local verification: Google adapter/API tests and two browser journeys cover nearby request bounds, authentication, input validation, visible initial suggestions, route selection, automatic text search and failure fallback. Synthetic browser evidence does not prove live Google results or OS permission behavior.

Provider reference: https://developers.google.com/maps/documentation/places/web-service/nearby-search

## Saved shortcuts and confirmation map

Saved Home/Work shortcuts now request a one-time current pickup lookup, resolve the address, obtain a standard quote and open confirmation with the map and Request ride. Empty slots still open setup. Denied/insufficient GPS, missing address or provider failure keeps the saved destination and permits manual entry. No ride is submitted without the final button. The native map frames the full road polyline and both endpoints using the existing dark/gold map style; failure shows endpoints and retry without an invented road route.

POST /v1/places/current validates the coordinate and reverse-geocodes with Google Geocoding v4, then resolves the returned street/premise place ID. Enable Geocoding API and allow it on the existing server key in addition to Places API (New) and Routes API. Geocoding gives an estimated nearby address: the rider must review pickup before requesting. Native location acquisition is bounded to 15 seconds and requires a recent fix within 100m accuracy.

GET /v1/quotes/:id/route requires the owning rider and an unexpired quote. It reads authoritative quote endpoints, requests an overview GeoJSON route from Routes API and returns bounded validated coordinates. The Quote schema remains unchanged for older clients. The route preview is fetched separately from pricing, so it can change with conditions and does not replace the quoted fare. Both calls are billable provider usage subject to account allowances. No hosted settings were changed by this implementation.

Verification includes five browser booking journeys, Google response parsing tests, quote ownership/expiry tests and both native JavaScript exports. Native binaries still need rebuilding for expo-location; exports do not prove native camera framing or physical GPS.

## Native rebuild troubleshooting

`Cannot find native module ExpoLocation` means JavaScript is using the location dependency but the installed native binary does not contain it. Regenerate the rider native project, install iOS pods, rebuild and reinstall the development app; Metro reload alone cannot repair this. Preserve local map-key configuration while regenerating. For simulator builds, let Xcode generate simulator signing (`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`) rather than applying device entitlements manually. This does not configure release signing or validate push delivery.

The September 12 rebuilt iOS and Android apps passed the synthetic saved-Work booking journey, including the fitted map and Request ride visibility. Confirmation maps are static overviews so page scrolling remains usable. Run `native-tests/booking-preview.yaml` against a dedicated synthetic API with its Work slot prepared. Android runner opt-in: `NATIVE_BOOKING_PREVIEW=1`, with `ACCOUNT_API_PORT` and `ACCOUNT_METRO_PORT` pointing to that API and rider Metro. The flow inspects the request action without submitting a ride. Metro started in CI mode disables reloads: restart that owned Metro after source edits before rerunning native checks.
