# Session lifecycle and stale auth responses

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

Implemented September 8, 2026 for both mobile apps. This closes local credential/profile races; it is not completion of managed-provider or native authentication verification.

## Problem and resulting behavior

Previously, a refresh or authorization-code exchange could finish after sign-out and save credentials again. Profile hydration or registration could similarly complete late and restore a signed-out profile. Concurrent native keychain writes and deletes had no shared ordering.

`packages/mobile-core/src/session-credentials.ts` now coordinates tokens independently of React and the auth provider:

- Every new login, sign-out, provider teardown and terminal refresh failure invalidates earlier work with a monotonically increasing generation.
- Token exchange, stored-session reads and refresh persistence verify their generation before applying results. Old results cannot overwrite a newer account or return a usable token to the waiting caller.
- SecureStore operations are serialized. A sign-out delete waits behind an already-started write, so that write cannot finish after the delete and resurrect credentials. Queued obsolete writes are skipped.
- Expired-token reads share one refresh per generation, including refresh-token rotation. An old refresh's finally block cannot clear a newer generation's pending refresh.
- Failed storage operations remain failures, but do not poison the queue and prevent a later deletion/retry.

The SessionProvider uses these guards for hydration, profile reads, registration and profile edits. Sign-out clears in-memory credentials and profile state before waiting on disk or provider revocation. An old account-screen logout callback cannot clear a newer session after its asynchronous preflight finishes. The existing driver offline/active-trip checks still run before deliberate sign-out.

If explicit sign-out cannot delete device credentials, the account screen offers Retry device sign-out. This repeats local cleanup without trying to use credentials that were already removed from memory. It does not claim successful persistent logout while SecureStore reports failure. A successful new login also clears any pending cleanup state after its initial storage deletion succeeds. Rider sign-out now prevents repeated taps and disables profile edits while checking trip status.

## Verification

Ten new deterministic controller tests cover late refresh success, late refresh failure after account replacement, a write already in progress during sign-out, late token exchange, hydration after sign-out, refresh coalescing/rotation, current refresh failure invalidation, storage-write failure recovery, independent refresh generations and failed-delete retry. These tests control promise completion order rather than relying on timers or network timing.

The mobile-core suite now has 44 tests; the driver suite retains 14 tracking/sign-out tests. Existing API authorization and database ownership tests remain unchanged. These tests run in the existing PR/main CI workflow.

Browser verification with the synthetic local API exercised rider sign-in → authenticated Home → Account → sign-out → welcome → sign-in again. It did not use real provider credentials or alter real rides. Both apps were exported for iOS, Android and web; package typechecks and lint passed. Controller tests verify persistence ordering with a fake storage adapter, not a real locked device keychain.

## Remaining requirements

- Repeat the exercised Auth0 protocol/simulator paths on physical iOS/Android, including cancellation and active-trip recovery; see [provider evidence](62-provider-setup-handoff.md).
- Device keychain failure/restart behavior and rendered provider-level race tests beyond the controller tests.
- Transient versus invalid-grant handling is now implemented; see [refresh recovery](46-auth-refresh-recovery.md). Actual provider behavior still needs native end-to-end verification.
- Driver operational recovery when an account is disabled or credentials expire during active work; this must not silently abandon trips or leave availability misleading.
- Provider-wide session revocation and cross-device logout policy. Local deletion does not prove a remote token was revoked; a refresh already accepted by the provider may need provider-specific cleanup.
- Environment-scoped persistence is implemented; complete physical-device storage and remaining authentication threat-model acceptance.

Already-authorized HTTP mutations may still finish on the server after a user signs out. Generation checks prevent stale local auth/profile application; they are not a rollback mechanism. Resource permissions, idempotency, active-trip constraints and server authorization remain necessary.
