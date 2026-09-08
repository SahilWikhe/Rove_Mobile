# Authentication refresh recovery

Implemented September 8, 2026 for the shared rider/driver SessionProvider.

## Behavior

An authentication refresh can fail because of network loss or provider availability. Previously every thrown refresh error cleared the session. The provider adapter now distinguishes the OAuth `invalid_grant` code from other failures. The installed Expo AuthSession TokenError implementation exposes that code through its `code` field.

An explicit `invalid_grant` remains terminal: the controller invalidates the session generation and clears credentials/profile state. Other refresh failures produce a safe retryable message without exposing provider descriptions. Missing discovery during a required refresh follows the same retryable path. Configuration failures such as `invalid_client` are retained for recovery too; they may require configuration correction rather than another network attempt.

On a retryable failure, memory and stored credentials remain unchanged. An expired access token is never returned. ApiClient stops before making an HTTP request, so it sends neither anonymous requests nor expired credentials. Concurrent requests share one refresh attempt and receive its failure; a later explicit request or existing foreground poll may retry. This change does not automatically replay a failed booking/payment mutation.

A successful refresh must still persist its rotated credentials before returning an access token. A storage failure remains terminal rather than falling back to the previous, potentially consumed refresh grant. Generation checks still prevent a late success or failure from changing a newer login or signed-out state.

## Evidence

Nine added cases cover retryable OAuth/configuration failures, explicit invalid-grant classification, concurrent refresh failure and subsequent recovery, prevention of API transport during refresh failure, and failure to persist rotated credentials. Existing generation, logout and keychain ordering tests remain in place. The mobile-core suite now has 58 passing tests.

Both apps' platform exports, workspace type checks and existing automated tests were run. These are deterministic adapter/controller tests and bundle checks; they do not claim verification against a configured managed auth provider or a real locked device keychain.

## Profile-loading recovery

Both welcome screens now expose Retry loading account when credentials exist but the profile could not be loaded. Retrying reuses the current credential generation and the existing profile API. It does not start a new authorization flow, erase saved credentials, register a second account or replay a ride mutation. Concurrent taps are guarded synchronously; stale callbacks cannot retry a replacement session. Sign-in remains disabled until initial session restoration is ready.

The synthetic rider and driver browser previews were each tested with `/v1/me` forcibly aborted: initial sign-in reached the retry state, a second failure retained it, and removing the network failure allowed retry to load the account. Existing session tests and both apps' exports were rerun. This is rendered browser recovery evidence; managed-provider/native keychain recovery still needs device verification.

## Remaining requirements

Verify the chosen provider's actual error/rotation behavior, native callbacks, refresh request timeout policy and recovery during an active driver trip. A lost response after server-side rotation may make the old grant unusable on retry; provider reuse/grace policy still needs end-to-end validation. Device cleanup after terminal storage failures and environment-specific session isolation also remain part of launch verification.
