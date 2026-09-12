# Account deletion fulfillment

## Current implementation

The rider and driver screens submit explicit deletion requests through support. Support resolution is not deletion. The Auth0 identity-removal adapter is implemented and locally tested, but is not wired to a public route, worker or runtime activation switch. Configuring credentials does not enable it. No real identity was deleted during development.

The adapter accepts only a database subject qualified with the configured Auth0 tenant issuer. It retrieves the exact user ID before deleting, requests only the user ID field, encodes the ID as a single URL segment, rejects identity mismatches and checks absence through a second authenticated read after deletion. An already absent identity lets a durable caller recover from a lost delete response. Unexpected status, malformed response, rate limit and network failure remain retryable errors; they never become successful completion. Provider details and credentials are excluded from errors. Requests have deadlines, disable redirects and bypass caching. Concurrent workers share short-lived server token acquisition; expired and rejected tokens are refreshed on the next attempt.

Auth0 profile removal also applies to social-login profiles inside Auth0; it does not delete the person's Google/Apple or other external account. Tenant deletion is not application-data erasure or proof that previously issued JWTs are unusable.

## Required durable workflow

These stages remain implementation work, not activated behavior:

1. Record an explicit owner-authorized deletion operation independent of the support ticket, with idempotent submission and status history. Do not infer authorization from arbitrary support text or a staff resolution response.
2. Apply the approved retention policy and record staff authority/MFA, policy revision and any legal/safety hold. Check active trips and unsettled financial obligations before closing access.
3. Atomically disable local account access, take the driver offline and revoke tracking/push registration. Persist the original subject or a durable revocation tombstone checked by all authentication/onboarding paths. Stale access tokens must not recreate a deleted profile.
4. Queue identity removal with durable retries and independent completion evidence. The Auth0 adapter below performs this provider step only; its caller must enforce steps 1–3.
5. Purge or anonymize application records and each eligible storage object/version under the approved retention matrix. Preserve required financial/audit evidence without exposing deleted profile data. Handle message content, saved places, location, documents, historical snapshots and command/outbox payloads explicitly.
6. Record retained classes, hold/review dates, provider/storage failures and backup restoration replay obligations. Mark fulfillment complete only when all required stages have evidence, with accurate retained-data disclosure.

Do not use `users.disabled`, resolved support status or one successful provider call as the account-deletion completion flag. Retention durations and exceptions are final owner decisions; no legal duration is invented here.

## Provider setup at final handoff

Prepare a dedicated server-only Auth0 machine-to-machine client in the environment's tenant with Management API scopes `read:users delete:users`. Do not reuse email-verification or mobile client credentials. The adapter configuration parser recognizes `AUTH0_DELETION_CLIENT_ID`, `AUTH0_DELETION_CLIENT_SECRET` and the matching `OIDC_ISSUER`; partial credentials and unsafe issuer URLs fail closed. Custom domains are not supported by this adapter yet; the existing configured canonical Auth0 issuer is required.

After the workflow exists, verify tenant isolation and deletion with dedicated synthetic identities only. Exercise present, already absent, interrupted delete, denied scope, expired token, rate-limited provider and failed post-delete verification. Also test stale JWT/onboarding, concurrent booking, financial holds, storage versions, retry/audit recovery and restored-data deletion replay. Local transport tests do not prove hosted permission or complete fulfillment.

## Sources

Auth0 documents [user deletion](https://auth0.com/docs/api/management/v2/users/delete-users-by-id), [direct user reads](https://auth0.com/docs/api/management/v2/users/get-users-by-id) and [Management API permissions](https://auth0.com/docs/manage-users/user-accounts/manage-users-using-the-management-api). These establish the provider API, not Rove's retention policy.
