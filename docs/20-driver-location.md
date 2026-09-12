# Driver location lifecycle

Status: implemented server grant boundary and native task integration; physical-device/background delivery verification remains outstanding.

## Ownership and access

The driver app layout owns tracking, not the Drive, Offer or Trip screen. Synthetic browser development uses a foreground controller. Native live driving uses a module-scope Expo TaskManager location task so callbacks can execute without mounting a React screen.

An authenticated, online driver calls `POST /v1/drivers/me/tracking-session` with an empty JSON object. The server generates a random 256-bit opaque credential, stores its SHA-256 hash and returns the credential with a twelve-hour expiry. One grant per driver is active; rotation invalidates the previous one. Lost issuance responses can be retried by issuing a new grant; plaintext credentials are never stored in idempotency command results.

The credential permits only:

- `POST /tracking/v1/location`: submit that driver's current location.
- `DELETE /tracking/v1/session`: revoke that credential.

It cannot read a ride, accept an offer, change availability, mint another credential or authenticate to account routes. No driver identifier is accepted in the upload body. A full OIDC token cannot authenticate to these tracking routes. Issuance requires the normal OIDC-authenticated driver account; account roles remain database-owned.

Every upload checks the current online state, disabled-account state, credential hash and expiry. Going offline deletes the tracking grant in the availability transaction. Revocation and account disablement take effect on subsequent uploads. Stale locations remain ineligible for matching according to the existing freshness rule.

## Sampling and privacy

Upload fields are coordinates, the device sample timestamp and horizontal accuracy in meters. The server accepts only valid coordinates, accuracy within 100 meters and timestamps no more than 30 seconds old or 5 seconds ahead. Per-grant monotonic timestamps discard duplicate/out-of-order delivery without refreshing driver eligibility.

Only the latest valid fix from a native callback batch is uploaded. Network failures do not create a persistent GPS queue; a later fresh fix retries. Overlapping callbacks are dropped while an upload is pending. Coordinates are not written to device storage or ordinary logs. This implementation stores the latest driver location, not a location-history table.

The device stores the location-only credential separately from login tokens in SecureStore with after-first-unlock, device-only keychain accessibility. This permits locked-device callbacks after the first unlock and prevents backup migration of that credential. Full OIDC access/refresh tokens retain when-unlocked device-only accessibility. The server expiry and revocation checks are authoritative even if a device retains a credential.

## Native lifecycle

Before going online, show an explanation of precise/background location use and request foreground then background permission. Android users may be taken to Settings to choose Allow all the time; iOS requires Always. No permission dialog is launched silently by the background task.

The app config enables iOS location background mode and Android background-location/foreground-service permissions. The running task displays the iOS location indicator and an Android foreground-service notification. Requested updates are approximately three seconds apart, with the same three-second background batching interval. Foreground synchronization updates an existing task with the new options without rotating its location grant. OS delivery is not a timing guarantee. Native callbacks faster than this are bounded to one upload attempt every three seconds, including after a headless process restart; only a deadline is persisted, never coordinates. A backwards wall-clock correction resets that short cadence deadline. Network failures wait for a new fix and server throttling retains its longer retry deadline. The faster cadence increases location-upload traffic and needs battery/network measurement on physical devices before production.

While foregrounded, the app checks the driver profile and tracking configuration, renewing a grant when less than one hour remains. The background credential cannot renew itself. Expiry stops local tracking until the app foregrounds and obtains a new grant. A server-revoked grant stops tracking and requires explicit Reconnect location before reissuance, preventing competing devices from automatically rotating each other's grants.

Going offline, sign-out, permission loss observed on foreground, or account change stops the native task and removes the local credential. Local lifecycle operations and callbacks serialize credential access. Cleanup queued during issuance wins after issuance finishes. Failed network revocation does not restore local tracking; the server still enforces offline/disabled/expiry checks.

Force-quitting can stop OS location delivery, and device vendors may apply additional restrictions. Rove must not represent force-quit tracking as guaranteed. Stale-location matching exclusion and active-trip operational escalation are required safeguards; the complete operational escalation flow is still being built.

## Verification evidence and remaining checks

Automated checks cover hash-only storage, rotation, expiry, disabled/offline drivers, invalid samples, concurrent duplicate uploads, credential scope, native task registration, permission denial, explicit reconnect, shutdown races and transport failure. Native library calls are mocked in the lifecycle unit tests; these are not device tests.

Expo configuration introspection confirms iOS `UIBackgroundModes` includes `location` and Android includes `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION`. Driver iOS/Android/web bundle exports pass.

Before pilot enablement, verify an installed development/release build on physical iOS and Android devices:

1. Grant precise foreground/background access after the in-app explanation; test denial and later Settings recovery.
2. Go online, open an offer, accept, navigate through pickup/start/completion, and verify fresh server locations throughout.
3. Lock the phone and use an external navigation app while an active trip continues.
4. Disable network, move, restore network and confirm only fresh fixes upload.
5. Go offline or sign out and verify the OS indicator/service and server uploads stop.
6. Disable the account, revoke/rotate a grant and verify tracking stops without exposing ride/account data.
7. Force-quit/relaunch and test battery restrictions; verify stale-location exclusion and support recovery.
8. Test grant expiration/renewal and a second-device takeover with explicit reconnect.

Do not run these checks against real rider trips or production credentials.

## References

The implementation follows [Expo Location background configuration and permissions](https://docs.expo.dev/versions/latest/sdk/location/), [TaskManager's module-scope task requirement](https://docs.expo.dev/versions/latest/sdk/task-manager/) and [SecureStore keychain accessibility](https://docs.expo.dev/versions/latest/sdk/securestore/). Native development builds are required for background-location verification; browser previews and bundle exports cannot prove OS background execution.
