# Account deletion fulfillment

## Current implementation

The rider and driver confirmation screens submit `deletionConsent: account-deletion-v1` with the account support request. Migration 0039 stores a separate immutable consent record, uniquely scoped to the account, in the same transaction as the ticket, command result and audit. Ordinary account messages, even identical deletion prose, create no deletion record. Support resolution is not deletion and does not remove consent. The Auth0 identity-removal adapter is wired to a default-off, staff-authorized closure operation and durable outbox worker. Configuring credentials alone does not enable closure. No real identity was deleted during development.

The adapter accepts only a database subject qualified with the configured Auth0 tenant issuer. It retrieves the exact user ID before deleting, requests only the user ID field, encodes the ID as a single URL segment, rejects identity mismatches and checks absence through a second authenticated read after deletion. An already absent identity lets a durable caller recover from a lost delete response. Unexpected status, malformed response, rate limit and network failure remain retryable errors; they never become successful completion. Provider details and credentials are excluded from errors. Requests have deadlines, disable redirects and bypass caching. Concurrent workers share short-lived server token acquisition; expired and rejected tokens are refreshed on the next attempt.

Auth0 profile removal also applies to social-login profiles inside Auth0; it does not delete the person's Google/Apple or other external account. Tenant deletion is not application-data erasure or proof that previously issued JWTs are unusable.

## Durable request status

`GET /v1/account-deletion` returns the authenticated active consumer's request or null. It exposes its reference, linked support reference, consent version, submission time and current `requested`, `closed` or `identity_removed` state. Closed consumers cannot authenticate to this endpoint; authorized staff can inspect progress. `GET /v1/staff/account-deletions/:id` requires verified staff MFA and `privacy.read`; the inspection is audited. Support permissions alone do not grant this privacy read. Neither endpoint accepts another consumer's owner ID or invokes deletion.

Concurrent or lost-response retries record one consent and one consent audit. An explicit confirmation can attach consent to an existing account ticket; changing an already-used idempotency key's payload is rejected. The database rejects consent rewrites/deletes, another owner's ticket, non-account tickets and non-consumer owners. It intentionally retains the original consent across later support submissions. Withdrawal/review UI and final data-erasure status remain future work.

Apply migrations 0039 through 0042 through the environment's migration procedure before deploying the consent-aware API, then release the updated apps. Older apps without the explicit field continue creating support requests only: do not automatically convert historical free text into erasure authorization. No hosted migration is implied by local testing or a main-branch push.

## Authorized account and identity closure

`POST /v1/staff/account-deletions/:id/close` requires MFA, `privacy.close`, an idempotency key and `{policyReference, reviewReference}`. The policy must exactly match the approved deployment configuration; the review reference identifies the staff retention/legal/safety review. Durable retention holds now block closure and new identity dispatches; see [retention controls](76-retention-holds.md). The operational policy/review still needs approval; the backend does not determine legal obligations. No consumer caller or ordinary support resolution can invoke closure.

Closure locks consent, driver and user rows, checks active trips, locks existing payment attempts against reconciliation, and rejects unsettled payment status, nonzero owner ledger balances or queued/review-required refunds/transfers. These are current operational holds; later refunds/disputes can still arise and retained financial records must remain serviceable. It never forgives a balance or changes processor funds.

In one transaction it disables the user, takes the driver offline, clears current location, deletes background tracking credentials and saved places, disables push registrations/removes their tokens, writes immutable authorization/audit evidence and queues `account.identity-delete`. Pending offers follow the existing offline-driver expiry/rematching path. Already accepted external push requests cannot be recalled.

The original unique Auth0-qualified subject remains on the disabled user row. Middleware rejects it; the onboarding upsert also rejects disabled rows to cover an in-flight request. Database triggers prohibit restoring access/changing that subject or role, and serialize active-ride and online-driver changes against closure. This currently prevents re-registration with the same subject; a future explicit re-registration policy/flow must distinguish a fresh authorization from a stale token. Do not remove the disabled identity mapping during later anonymization without equivalent revocation protection.

The worker checks active holds and records durable dispatch evidence after committed closure, then calls the identity provider outside database locks and records `identity_removed` after confirmed absence. A later hold blocks new attempts but cannot recall a dispatched request. Concurrent retries and lost responses target the same original subject. Provider failures leave the account closed and identity work retryable. Generic outbox leases/backoff/dead-letter handling apply. `POST /v1/staff/account-deletions/:id/retry-identity`, with empty JSON and an idempotency key, requires `privacy.close` and MFA to requeue an exhausted job; it does not interrupt a live lease or delete a different identity. `GET /v1/staff/account-deletions/:id/closure` requires `privacy.read` and MFA and audits the read.

Neither `closed` nor `identity_removed` claims full erasure. The account name, historical trips/quotes, messages, document objects/versions, payment bindings, financial journals, support content, command results and other retained records have not yet been fully anonymized or purged.

## Remaining fulfillment work

- Build the policy-driven application/storage cleanup stages using the implemented retention holds, including review/withdrawal handling before irreversible execution.
- Purge or anonymize eligible message content, documents, historical snapshots and command/outbox data while preserving required financial/safety/audit evidence with restricted access.
- Record retained classes, review dates, storage/provider failures and backup restoration replay obligations. Add accurate completion/retained-data disclosure and complete staff operational UI integration in its separate repository.
- Verify physical-device logout/tracking/push behavior and dedicated hosted Auth0 deletion. Local synthetic workflow tests do not prove those acceptances.

Retention durations and exceptions remain final owner decisions; no legal duration is invented here. Do not activate closure while treating this partial cleanup as fulfilled erasure.

## Provider setup at final handoff

Prepare a dedicated server-only Auth0 machine-to-machine client in the environment's tenant with Management API scopes `read:users delete:users`. Do not reuse email-verification or mobile client credentials. The adapter configuration parser recognizes `AUTH0_DELETION_CLIENT_ID`, `AUTH0_DELETION_CLIENT_SECRET` and the matching `OIDC_ISSUER`; partial credentials and unsafe issuer URLs fail closed. Custom domains are not supported by this adapter yet; the existing configured canonical Auth0 issuer is required.

Set `ACCOUNT_CLOSURE_ENABLED=true` only after migration, staff authorization, approved review policy and dedicated synthetic acceptance. `ACCOUNT_CLOSURE_POLICY_REFERENCE` must identify that approved policy; empty or partial activation configuration fails closed. HTTP and worker hosts need the same settings. Keep the switch false until these prerequisites and remaining fulfillment obligations are addressed.

Local PostgreSQL/HTTP/outbox tests verify consent, access closure, identity progress, staff authorization, retries, booking races, financial holds, immutable authorization, audit rollback and stale-token rejection. Browser tests separately cover both apps' confirmation flow. These do not verify complete retained-data erasure.

Before activation, verify tenant isolation and deletion with dedicated synthetic identities only. Exercise present, already absent, interrupted delete, denied scope, expired token, rate-limited provider and failed post-delete verification. Also test stale JWT/onboarding, concurrent booking, financial holds, storage versions, retry/audit recovery and restored-data deletion replay. Local transport tests do not prove hosted permission or complete fulfillment.

## Sources

Auth0 documents [user deletion](https://auth0.com/docs/api/management/v2/users/delete-users-by-id), [direct user reads](https://auth0.com/docs/api/management/v2/users/get-users-by-id) and [Management API permissions](https://auth0.com/docs/manage-users/user-accounts/manage-users-using-the-management-api). These establish the provider API, not Rove's retention policy.
