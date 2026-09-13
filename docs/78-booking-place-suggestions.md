# Booking place suggestions

Rider Figma 4:20 supplies the place-row layout. The app now shows nearby rows before typing, then searches after a 500ms typing pause (minimum three characters). Selecting a result fills the focused endpoint. Search remains available without location permission. No current-location label is substituted for a verified provider place.

Native builds use expo-location foreground access only. Existing permission permits one lookup on screen mount; otherwise the rider taps Suggest places around me. Location acquisition times out after 15 seconds, and failures preserve manual address entry. No background location task or coordinate persistence is added. Synthetic development uses local fixtures instead of device GPS.

POST /v1/places/nearby requires normal authentication, strict Coordinate input and the places rate-limit budget. Google Places API (New) searchNearby uses a fixed 5km circle, distance ranking and five results with the existing limited place field mask. The same server Places key is used. Provider errors fail visibly; no fabricated live results replace them. This is a billable Google capability subject to the account's allowance; staging does not inherently make provider requests free.

Deploy the updated API and rebuild the rider native app to include the location module and permission text. Existing installations cannot obtain a new native module through JavaScript refresh alone. No new key is required if the server key already permits Places API (New). Confirm foreground permission granted/denied, unavailable GPS, nearby result selection and provider restrictions on actual devices before release.

Local verification: Google adapter/API tests and two browser journeys cover nearby request bounds, authentication, input validation, visible initial suggestions, route selection, automatic text search and failure fallback. Synthetic browser evidence does not prove live Google results or OS permission behavior.

Provider reference: https://developers.google.com/maps/documentation/places/web-service/nearby-search
