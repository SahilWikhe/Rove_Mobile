# Driver navigation handoff

The active driver trip now offers **Directions to pickup** while matched, approaching or waiting, and **Directions to destination** while in progress. It uses the existing secondary button and error banner. Completed, cancelled, searching and interrupted trips offer no navigation action.

## Authorization and lifecycle

Each explicit tap reads the owned trip again through the authenticated ride endpoint. A failed read never falls back to cached coordinates. A different trip, older version, missing endpoint, ended trip, changed leg or changed coordinate prevents opening Maps and asks the driver to check the updated trip. A newer version on the same leg with the same endpoint remains usable.

A pending launch is cancelled on screen blur, unmount, app background, account/trip/version replacement or disabled controls. Duplicate taps share the busy guard. Uncertain trip operations and read errors disable navigation until resolved. A late response from a transport that ignores cancellation cannot launch Maps.

This is a read followed by an external handoff, not a database lock across applications. A trip can change after the final read; coordinates already delivered to Maps cannot be recalled. Drivers must continue to follow Rove's current trip status. Opening directions never records arrival, starts a trip or completes it; those remain explicit confirmed actions.

## Maps behavior and privacy

The fixed HTTPS Google Maps URL includes only destination coordinates and driving mode. It contains no rider name, address label, account ID, access token or driver origin. Google receives the selected coordinates when the driver opens directions. Maps chooses its current origin and may open the installed app or a browser. Turn-by-turn navigation depends on device/location availability; it is not guaranteed by this link.

[Google Maps URL documentation](https://developers.google.com/maps/documentation/urls/get-started) specifies `api=1` and does not require an API key for this URL handoff. This does not remove separate API key, billing or release requirements for embedded maps, geocoding and route estimates.

## Verification

- Six navigation behavior tests cover leg selection, exact outbound data, changed/ended trips, stale reads, authorization failures, cancellation and platform launch errors. The driver package has 20 passing tests.
- The two-app browser trip checks pickup/destination handoffs and unchanged trip state before each explicit milestone, then absence of navigation after completion. The browser intercepts external opening; it does not contact Google.
- Workspace type checking, lint and import boundaries pass. Driver iOS, Android and web exports pass.
- Physical-device Maps app/browser launching and real turn-by-turn guidance remain release checks. This checkpoint does not claim those were exercised or that the full mobile product is complete.
