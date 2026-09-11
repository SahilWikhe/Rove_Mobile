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

## Email verification gate and rollout

A successful Auth0 login does not prove ownership of an email address. The API supports
`OIDC_REQUIRE_VERIFIED_EMAIL=true`: every account bearer request under `/v1/*` must carry
`https://roveride.co/email_verified` with the boolean value `true` in a JWT whose signature,
issuer, audience and lifetime have already passed verification. Missing, false, string and
numeric values return `403 EMAIL_VERIFICATION_REQUIRED`. Invalid credentials remain `401`.
The API does not trust request headers, user-editable metadata or an unsigned mobile claim.
Existing independently authenticated webhooks and background location grants are unchanged.

Production configuration requires this check and rejects explicit disabling. Preview and
staging default off for the staged rollout; local synthetic identity is a separate test adapter.
This implementation alone is not evidence that the staging environment enforces verification.

Both apps request the OIDC `email` scope and display the shared Rove verification notice when
profile loading returns this error. The notice does not expose account creation, booking or
normal profile retries. Its primary action starts a fresh PKCE login: clicking the button does
not mark an account verified, and an old token cannot acquire updated claims. A different-account
option uses the same explicit-login flow. Credentials retain the existing scoped keychain and
epoch protections. A verified response either loads the existing profile or starts Rove profile
creation. Browser recovery tests use synthetic API responses, not delivered email.

### Provider configuration and activation

1. Deploy `scripts/auth0-email-claim.cjs` as an Auth0 **post-login** Action. Configure its
   `ROVE_API_AUDIENCE` secret with the exact environment API audience. The Action emits the
   namespaced claim only for that audience, using Auth0's `event.user.email_verified === true`.
   Preserve existing Action bindings when adding it to the login flow. Keep the Action enabled
   for refresh exchanges as well as interactive logins. Do not deny login in the Action: the
   API gate supplies the mobile recovery state.
2. Verify the provider's verification-email template and sender. Absence of a custom sender
   does not disable Auth0's built-in testing sender. A completed verification-email job does
   not establish inbox delivery. Check provider logs, spam and actual receipt. Never manually
   mark a test account verified to simulate ownership.
3. Test receipt and the provider verification link with a consenting test user. Test a fresh
   login after clicking the link and confirm the API accepts the signed claim. Test unverified
   signup and existing users, stale tokens, expired links, cancelled login and switching accounts.
4. Deliver the updated mobile build, then enable `OIDC_REQUIRE_VERIFIED_EMAIL=true` in the
   staging API deployment and verify the deployed endpoints. Do not enable it on a deployment
   whose clients cannot recover. Existing tokens without the claim require fresh authentication.
5. Before release, provide authenticated, rate-limited resend support and reliable configured
   email delivery. The current notice does not claim to send email and has no resend button.
   A server-side resend implementation must bind the recipient to the verified token subject;
   never accept an arbitrary email address or expose Management API credentials to mobile clients.

The current automated checks cover strict signed-claim enforcement, rollout configuration,
Action audience isolation and both apps' blocked/recovered UI. Native link delivery, provider
resend UI and activated staging enforcement require separate verification.

References: [Auth0 custom claims](https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims),
[verification email](https://auth0.com/docs/manage-users/user-accounts/verify-emails), and
[email providers](https://auth0.com/docs/customize/email/smtp-email-providers).

### Current verification evidence

The staging Action was built, deployed and bound to post-login, with its audience limited to
Rove staging. One owner-approved resend job completed; the owner confirmed receipt and clicked
the link, and a subsequent Auth0 read returned `email_verified: true`. This establishes that the
manual resend path worked for that account; the original missing signup email remains unexplained.
The runtime gate is not yet activated in staging. In-app resend remains outstanding.

API regression suite: 125 passing tests. Shared mobile-core suite: 140 passing tests. Rider and
driver browser verification/re-login tests both passed, as did all package and E2E type checks,
changed-code lint and formatting. These checks do not substitute for native interactive acceptance.
