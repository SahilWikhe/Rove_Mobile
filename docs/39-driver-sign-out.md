# Driver sign-out and tracking cleanup

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

The driver Account screen now includes “Go offline and sign out.” It uses the existing backend availability command rather than only hiding the online UI or deleting local credentials.

The ordered flow is:

1. Request offline availability with a new explicit command key.
2. Fetch the current driver profile and require `online: false`; a cached command result alone is insufficient.
3. Stop native location updates and remove/revoke the location-only grant.
4. Clear the account session and return to the welcome screen.

The server's existing driver-row lock and active-assignment check prevent going offline with an accepted trip. A failed or uncertain offline request keeps the session available for recovery. A current online profile or native-stop failure also prevents proceeding to account cleanup. There is no automatic replay of the availability mutation; another tap is an explicit new attempt.

The screen prevents repeated taps while the operation is pending. Profile editing is disabled during this flow without discarding the draft if sign-out fails. Successful server offline state revokes tracking access independently of native cleanup. Native cleanup removes the local grant before stopping the OS task and attempts remote revocation; a transport failure in that final revocation does not undo the already-confirmed offline state.

## Evidence and limits

Five controller tests cover sequencing, active-trip rejection, uncertain confirmation, a stale offline response and native-stop failure followed by an explicit retry. Existing real PostgreSQL matching tests verify that an assigned driver cannot go offline; tracking tests verify offline grant revocation and rejected later uploads. Both apps continue to share the existing OIDC credential provider.

A native driver Debug build compiled and launched on the local iOS 26.5 simulator, and the synthetic driver home screen was visually inspected. This does not prove sign-out on a physical device or all OIDC callback/refresh races. Session race guards and refresh recovery are now implemented, and Android Auth0 session acceptance has been exercised. Full physical-device background cleanup and active-trip recovery remain outstanding; see the current authentication guides. No production identity or location data was used.
