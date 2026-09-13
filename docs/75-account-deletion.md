# Account deletion fulfillment

## Current implementation

The rider and driver confirmation screens submit `deletionConsent: account-deletion-v1` with the account support request. Migration 0039 stores a separate immutable consent record, with one active request per account, in the same transaction as the ticket, command result and audit. Ordinary account messages, even identical deletion prose, create no deletion record. Support resolution is not deletion and does not remove consent. The Auth0 identity-removal adapter is wired to a default-off, staff-authorized closure operation and durable outbox worker. Configuring credentials alone does not enable closure. No real identity was deleted during development.

The adapter accepts only a database subject qualified with the configured Auth0 tenant issuer. It retrieves the exact user ID before deleting, requests only the user ID field, encodes the ID as a single URL segment, rejects identity mismatches and checks absence through a second authenticated read after deletion. An already absent identity lets a durable caller recover from a lost delete response. Unexpected status, malformed response, rate limit and network failure remain retryable errors; they never become successful completion. Provider details and credentials are excluded from errors. Requests have deadlines, disable redirects and bypass caching. Concurrent workers share short-lived server token acquisition; expired and rejected tokens are refreshed on the next attempt.

Auth0 profile removal also applies to social-login profiles inside Auth0; it does not delete the person's Google/Apple or other external account. Tenant deletion is not application-data erasure or proof that previously issued JWTs are unusable.

## Durable request status

`GET /v1/account-deletion` returns the authenticated active consumer's request or null. It exposes its reference, linked support reference, consent version, submission time and current `requested`, `withdrawn`, `closed` or `identity_removed` state. Closed consumers cannot authenticate to this endpoint; authorized staff can inspect progress. `GET /v1/staff/account-deletions/:id` requires verified staff MFA and `privacy.read`; the inspection is audited. Support permissions alone do not grant this privacy read. Neither endpoint accepts another consumer's owner ID or invokes deletion.

Both mobile deletion screens now load this durable status alongside support history. The received state is based on consent status or the current successful submission receipt, not matching support prose or an open-ticket flag. Resolving a support ticket therefore does not expose a new deletion action. Initial/refresh status failures keep confirmation unavailable until a successful reload; a lost submission response preserves the original idempotency key for retry. The card distinguishes support resolution from actual account/data deletion. Withdrawal is available only while the durable request is pending; no erasure-completion claim is added.

Concurrent or lost-response retries record one consent and one consent audit. An explicit confirmation can attach consent to an existing account ticket; changing an already-used idempotency key's payload is rejected. The database rejects consent rewrites/deletes, another owner's ticket, non-account tickets and non-consumer owners. It intentionally retains the original consent across later support submissions. Final staff review UI and data-erasure status remain future work.

## Withdrawal before closure

`POST /v1/account-deletion/:id/withdraw` accepts empty JSON and an idempotency key from the active owning rider or driver. It locks the owner before consent, preserves all original consent fields and adds a one-way withdrawal timestamp plus audit in the same transaction. Staff cannot withdraw on a consumer's behalf through this endpoint. Disabled accounts cannot replay it. Withdrawal does not restore a closed account or recall dispatched identity deletion. Closure and withdrawal serialize on the same owner; exactly one can win.

Migration 0046 changes the owner index to permit only one non-withdrawn request. Original records cannot be deleted, rewritten or reactivated. A later explicit request uses fresh consent and a new support ticket; replaying an old submission or withdrawal cannot reactivate or cancel the newer request. Support rate/open-ticket limits still apply. Status returns the current active request, otherwise the most recent withdrawn request. Staff inspection by request ID retains the historical state.

Both apps offer Withdraw deletion request, a confirmation with Keep deletion request, and a persisted withdrawn state. Lost responses retry the same withdrawal key. After acknowledgement the form reloads authoritative current status before offering a fresh request; status failures require refresh. No provider request occurs during withdrawal.

Rollout requires migration 0046 and its predecessors. This is a coordinated API/schema change: the old unconditional `ON CONFLICT(owner_id)` statement is incompatible with the new partial index. Drain/stop old HTTP and worker processes, apply migrations through the environment procedure, start the compatible API/workers, verify synthetic consent/withdrawal/new-consent behavior, and then release the updated apps. Do not roll back to the old API against the new index or discard withdrawal history to restore the old unique constraint. Older mobile clients may reject the new withdrawn enum on their deletion-status page; the updated clients are required for the withdrawal journey. Older clients without the explicit consent field still create support requests only. No hosted migration or activation is implied by local testing or a main-branch push.

## Authorized account and identity closure

`POST /v1/staff/account-deletions/:id/close` requires MFA, `privacy.close`, an idempotency key and `{policyReference, reviewReference}`. The policy must exactly match the approved deployment configuration; the review reference identifies the staff retention/legal/safety review. Durable retention holds now block closure and new identity dispatches; see [retention controls](76-retention-holds.md). The operational policy/review still needs approval; the backend does not determine legal obligations. No consumer caller or ordinary support resolution can invoke closure.

Closure locks driver, user and then consent rows, checks active trips, locks existing payment attempts against reconciliation, and rejects unsettled payment status, nonzero owner ledger balances or queued/review-required refunds/transfers. These are current operational holds; later refunds/disputes can still arise and retained financial records must remain serviceable. It never forgives a balance or changes processor funds.

In one transaction it disables the user, takes the driver offline, clears current location, deletes background tracking credentials and saved places, disables push registrations/removes their tokens, writes immutable authorization/audit evidence and queues `account.identity-delete`. Pending offers follow the existing offline-driver expiry/rematching path. Already accepted external push requests cannot be recalled.

The original unique Auth0-qualified subject remains on the disabled user row. Middleware rejects it; the onboarding upsert also rejects disabled rows to cover an in-flight request. Database triggers prohibit restoring access/changing that subject or role, and serialize active-ride and online-driver changes against closure. This currently prevents re-registration with the same subject; a future explicit re-registration policy/flow must distinguish a fresh authorization from a stale token. Do not remove the disabled identity mapping during later anonymization without equivalent revocation protection.

The worker checks active holds and records durable dispatch evidence after committed closure, then calls the identity provider outside database locks and records `identity_removed` after confirmed absence. A later hold blocks new attempts but cannot recall a dispatched request. Concurrent retries and lost responses target the same original subject. Provider failures leave the account closed and identity work retryable. Generic outbox leases/backoff/dead-letter handling apply. `POST /v1/staff/account-deletions/:id/retry-identity`, with empty JSON and an idempotency key, requires `privacy.close` and MFA to requeue an exhausted job; it does not interrupt a live lease or delete a different identity. `GET /v1/staff/account-deletions/:id/closure` requires `privacy.read` and MFA and audits the read.

Neither `closed` nor `identity_removed` claims full erasure. The account name, historical trips/quotes, messages, document objects/versions, payment bindings, financial journals, support content, command results and other retained records have not yet been fully anonymized or purged.

## Remaining fulfillment work

- Build the policy-driven application/storage cleanup stages using the implemented retention holds, including staff review before irreversible execution.
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

## Document-version erasure provider

`S3DocumentErasure` removes one authorized inbox or quarantine object version and verifies that exact version is absent. The reference includes the document ID, matching inbox/quarantine key and a non-null version ID; the bucket, region and expected AWS account come from validated server configuration. It checks bucket versioning and a complete validated per-document version inventory, sends a version-specific delete, then independently repeats complete discovery to verify absence. It does not use HEAD or read file contents. Partial/denied version listings never prove absence. Already absent versions recover interrupted/lost-response operations without another delete. Permission failures, malformed receipts, delete markers, remaining versions and unverified responses stay failures with sanitized errors. It never bypasses S3 Object Lock or governance retention.

This adapter is wired into the default-off approved cleanup workflow. The dedicated staging role has been provisioned and its policy simulated; deployment activation and live storage acceptance remain pending. No objects or environment flags have changed. The caller must first persist an approved cleanup manifest, check the account's retention holds and record dispatch evidence. A single absent version does not prove all account documents are erased: the manifest must include every eligible quarantine/inbox version and orphaned upload, as well as replicas and backup obligations. Ongoing upload/scanning access must be fenced before final inventory and erasure.

The dedicated cleanup role allows only `s3:GetBucketVersioning`, prefix-restricted `s3:ListBucketVersions` and prefix-restricted `s3:DeleteObjectVersion`. Existing upload/download/scanner roles should not gain deletion permissions. Exact-version removal is irreversible and must remain behind the approved workflow and policy. Hosted synthetic acceptance remains required, including retained/locked versions, denied permissions and retry recovery.

AWS describes [version-specific deletion](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html) and [version discovery](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html). Local synthetic provider tests establish adapter behavior only.

## Document-version discovery

`S3DocumentInventory.discover(documentId)` reads all version-list pages under that reservation's inbox and quarantine prefixes, including orphaned attempts that never reached the attached database receipt. It returns separately classified object versions and delete markers. It checks bucket/prefix identity, exact document paths, version references and complete pagination, carrying both key and version markers. The installed AWS SDK does not expose a `ListObjectVersions` paginator, so the adapter implements that dual-marker sequence explicitly.

Partial, malformed, repeated, cross-scope, unversioned/null-version or excessive results fail with a sanitized error. No partial inventory is returned after failure. Each discovery is bounded to fifteen seconds, one hundred pages per prefix and ten thousand combined entries. These limits are operational failure boundaries, not silent truncation or retention policy. Higher-volume cases require reviewed processing rather than treating the bounded result as complete.

This read-only provider requires `s3:ListBucketVersions` on the configured bucket, restricted to the intended document prefixes and expected account. It does not authorize deletion or claim an atomic snapshot: concurrent uploads can create later versions. The cleanup workflow must fence new uploads, account for previously issued forms and in-flight storage requests, persist and approve the manifest, then rediscover after cleanup. Delete markers are not file-content erasure; they remain distinct review items and are not passed to the object-version erasure adapter. Document reservations must be retained until storage discovery/proof and restore-replay obligations are satisfied.

Fresh discovery is now exposed through the default-off staff storage-inspection route described in docs/77-document-cleanup-plans.md. Durable manifest authorization/execution and tracked upload fencing are implemented; uncertain-write reconciliation and final erasure fulfillment remain incomplete. No live storage request or permission grant is performed by these local changes. See AWS [ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html) for both pagination markers and version/delete-marker responses.

## Storage-write settlement barrier

Migration 0043 adds immutable `document_storage_writes` dispatch and settlement evidence. Server quarantine uploads now recheck the active driver and unexpired reservation under the same driver/user lock order used by closure, then commit an exact-key write intent and audit before calling storage. Provider calls run outside transactions. A verified version receipt and settlement audit commit before attachment. If closure races with storage, confirmed write evidence is still recorded even though attaching that file is rejected. Orphan versions remain discoverable by reservation prefix.

A timeout, malformed receipt, process crash or failed settlement transaction leaves the attempt unsettled. Expiry alone never clears it. `assertDocumentWritesSettled` is a necessary cleanup barrier: it requires a closed disabled account, expired document reservations and no unsettled recorded writes. Cleanup must separately enforce retention holds/policy and full storage discovery. New write intents and changes/deletion of evidence are guarded by the database. Upload receipts and object paths remain server-only.

This is not yet a complete write-quiescence guarantee. Previously issued presigned inbox POSTs can start before expiration and finish later, and pre-migration processes may have unrecorded writes. Before rollout, apply migration 0043 to HTTP/worker databases, replace/drain old upload processes, and establish a reviewed legacy-write baseline. The durable cleanup workflow must reconcile uncertain attempts, account for accepted inbox requests, and rediscover eligible versions before claiming final storage completion. No automatic expiry or invented grace period is treated as proof that an uncertain external request cannot finish. Operator reconciliation, cloud cleanup acceptance and backup replay remain open work. The approved manifest and default-off worker are implemented as described below.

Local PostgreSQL tests cover committed dispatch before provider calls, closure during I/O, settlement surviving rejected attachment, uncertain results, expired reservations, audit rollback and immutable/database-guarded evidence. No real storage requests, hosted migration or cleanup activation have been performed.

The [document cleanup domain](77-document-cleanup-plans.md) now implements immutable manifests, explicit policy/quiescence approval, per-version outbox execution, status and audited recovery. After explicit user approval of the target/role/scope, staff API and runtime wiring are implemented behind a default-off cleanup flag. Dedicated staging role provisioning and policy simulation are complete; live OIDC/storage absence verification and hosted activation are still outstanding. Full account erasure remains incomplete.

## Definitive pre-dispatch upload failures

Migration 0047 adds immutable `not_dispatched_at` evidence for a tracked quarantine write whose S3 privacy/versioning preflight failed before any PutObject invocation. Only the internal storage adapter's typed pre-dispatch outcome can set it; matching error text or a client field cannot. The timestamp and audit commit together. Audit failure leaves the original intent unresolved. This outcome has no object version and cannot later become a successful write or be cleared.

The adapter separates read-only bucket checks from the write call. Any exception after invoking PutObject, including an abort, SDK failure, malformed receipt or misleading error type, remains uncertain. Existing unresolved rows are not retroactively marked by age or inventory absence. Pre-dispatch proof only removes that specific intent from the pending-write query; active reservations, account closure, retention holds, inbox quiescence and fresh version discovery remain required. It does not claim document or account erasure.

Apply 0047 before deploying the compatible HTTP and worker code; all prior migrations, including 0046's coordinated rollout requirement, still apply. Older 0046-compatible hosts conservatively continue treating these rows as pending. No hosted migration, new AWS permission, provider deletion or cleanup activation is part of this change. Interrupted writes actually dispatched to storage and legacy/presigned inbox requests still need reconciliation.

## Recovering confirmed upload outcomes

The tracked quarantine store now retries database persistence up to three times for an explicit set of transient transaction/connection errors, with short bounded delays. It retries only a verified version receipt or typed proof that no write was dispatched already held by the current request. It never repeats provider upload I/O or infers success from a listing, timeout or elapsed time.

Each attempt locks the exact document/write row. A matching committed outcome recovers a lost commit response without changing its timestamp or duplicating the audit; a conflicting outcome is rejected. New outcome evidence and its audit commit together. Permanent audit errors and exhausted connection failures remain failures. Process loss, uncertain provider responses, legacy writes and presigned inbox requests still require reconciliation; this recovery does not resolve historical pending rows. No migration or runtime flag change is required beyond the existing 0047 prerequisite.
