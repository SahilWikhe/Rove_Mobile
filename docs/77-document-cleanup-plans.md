# Document cleanup plans

## Implemented domain workflow

The server domain can prepare an exact per-document inventory, record an explicit approval, queue one outbox job per object version, track dispatch and verified absence, inspect aggregate progress, and recover exhausted jobs. Migration 0044 stores immutable plans, approvals and version targets. This workflow is tested against disposable local PostgreSQL and synthetic providers. It is connected to staff HTTP routes and the outbox runtime behind an explicit default-off flag. No real cleanup role has been provisioned, no hosted cleanup settings have been enabled and no real S3 files have been deleted.

Preparation requires verified staff MFA and `privacy.cleanup`, an owned document on a closed disabled account, expired upload reservations, settled recorded quarantine writes and no active retention holds. Full inbox/quarantine discovery runs outside transactions. The service rechecks account/hold barriers after discovery before committing the plan. The inventory hash covers a canonical ordering of discovered entries; duplicates and foreign document paths are rejected. Object versions become immutable work items. Delete markers are counted separately and are not silently treated as deleted content.

Approval requires the same staff permission/MFA, the exact manifest hash, the configured cleanup policy reference, an operational review reference, a write-quiescence review reference and an earliest execution timestamp. No retention duration or legal conclusion is invented. Quiescence review is an explicit operational dependency: already-accepted inbox uploads, uncertain/legacy writes and any storage copies must be accounted for. A reference is not automated proof that those operations are finished. The current unsettled-write barrier cannot be overridden by this approval.

The approval, audit, earliest execution time and per-version jobs commit together. A later request cannot add targets to a prepared plan or change an existing approval. Idempotency replay does not duplicate approval/jobs. Staff permissions are rechecked before replay. `privacy.read` and MFA protect audited plan inspection. The staff dashboard remains a separate-repository integration.

## Worker behavior and scope

Each `document.version-delete` job addresses a single immutable item ID, never an arbitrary key supplied by a client. Before every new provider attempt the service requires an approved, due plan, closed account, settled writes and no active holds. Dispatch evidence commits before provider I/O, which runs outside transactions. Verified absence and its audit commit together. A provider failure or failed result transaction leaves the attempt unresolved and retryable.

A hold placed after dispatch cannot recall the earlier provider request; truthful confirmation of that earlier request may still be recorded. Already confirmed work can acknowledge retries without another provider call even if a later hold exists. Exhausted jobs can be requeued through the domain's audited recovery operation only after current authorization and barriers pass. Active leases are not interrupted, and the plan's earliest execution time is preserved.

Plan status means:

| State | Meaning |
| --- | --- |
| `draft` | Inventory prepared; no version removal authorized |
| `approved` | Exact version targets authorized; work is pending or unresolved |
| `versions_removed` | Every object version recorded in this plan has verified absence; an approved empty plan has no object targets |

`versions_removed` does **not** mean the whole document, account, every storage copy or backup is erased. Delete markers, versions arriving after discovery, other reservations, application records and restore replay require additional handling. Final cleanup must rediscover and process eligible residual versions under an approved workflow; no public completed-erasure claim is wired to this state.

## Pending runtime connection and approval

The initial runtime connection was rejected by automatic approval review. The user subsequently explicitly approved the existing private document bucket, separate limited cleanup role and exact-version scope, with activation remaining off. The approved source connection is now implemented; this is not permission to activate production or delete real files.

Configuration on HTTP and worker hosts:

| Variable | Requirement |
| --- | --- |
| `DOCUMENT_CLEANUP_ENABLED` | Defaults off; only the exact value `true` enables routes/handler/provider construction |
| `DOCUMENT_CLEANUP_POLICY_REFERENCE` | Explicit approved policy reference matching each plan approval |
| `DOCUMENT_CLEANUP_AWS_ROLE_ARN` | Required dedicated role in the configured owner account; must differ from configured upload and GuardDuty roles |
| `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_REGION`, `DOCUMENT_S3_OWNER_ACCOUNT_ID` | Existing private document storage scope; no alternate cleanup bucket is accepted |

The deployment factory uses the existing Vercel OIDC AWS credentials provider for the dedicated role. Cleanup does not fall back to upload credentials or the ambient AWS credential chain. Both S3 clients close with the runtime. This setup requires valid Vercel OIDC context on the HTTP/worker host; arbitrary external workers need an explicitly reviewed credential provider before activation. Missing required config or a missing injected cleanup provider prevents enabled runtime composition.

Staff endpoints (authenticated, MFA and current domain permissions required):

| Method/path | Operation |
| --- | --- |
| `POST /v1/staff/documents/:id/cleanup-plans` | Prepare inventory; strict empty JSON body and idempotency key |
| `GET /v1/staff/document-cleanup-plans/:id` | Audited aggregate inspection under `privacy.read` |
| `POST /v1/staff/document-cleanup-plans/:id/approve` | Approve the exact manifest/policy/review/quiescence/time contract |
| `POST /v1/staff/document-cleanup-plans/:id/retry` | Recover exhausted work; strict empty JSON body and idempotency key |

Disabled endpoints return `DOCUMENT_CLEANUP_UNAVAILABLE`; no cleanup provider or handler is constructed. Already queued cleanup jobs reaching a disabled host cannot delete files, but the generic worker may dead-letter them as unknown topics. Keep HTTP/worker activation coordinated and use audited recovery after re-enabling; disabling cannot recall a provider call already dispatched.

Role provisioning and cloud acceptance remain outstanding. Limit the role to the existing bucket and approved document prefixes, with version listing, version metadata reads, version deletion and bucket-versioning verification. Never grant unversioned deletion, object writes, bucket administration or governance-retention bypass. Validate the exact IAM/bucket-policy combination with synthetic versions before activation. The existing scan-tag quarantine read deny can also block the adapter's HEAD verification of unclean/unscanned versions; do not remove that deny casually or claim those versions are removable. Resolve a metadata-only verification strategy or narrowly reviewed cleanup access before accepting that path. Missing-version HEAD responses must be distinguishable from denied access; a 403 never establishes absence. See [AWS HEAD permissions and missing-object responses](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html).

Keep activation off until migrations, upload reconciliation, policy and synthetic hosted acceptance are complete. No cloud role, bucket policy, deployment environment or hosted migration was changed in this checkpoint.

## Verification and remaining work

Local tests cover full prepare/approve/outbox execution, manifest/MFA/policy failures, delayed execution, holds before and during discovery and after dispatch, current-permission checks on replay, immutable targets/evidence, approval/result audit rollback, lost-result retry and exhausted-job recovery without interrupting active leases. Runtime tests additionally cover default-off behavior, missing provider/config, distinct role/account requirements, authenticated/MFA routes, unknown request fields, manifest mismatch, failed-provider recovery, worker dispatch and replay. These tests do not establish real S3 IAM acceptance, a deployed enabled staff API or complete retention-policy fulfillment.

Remaining work includes cloud role/policy acceptance, review UI, uncertain-write and inbox reconciliation, residual-version rediscovery, marker/copy handling, retained application-data cleanup and backup replay. Apply migration 0044 only as part of the reviewed rollout after migrations 0041–0043. Production activation and policy/commercial decisions remain final handoff items.

See [account deletion](75-account-deletion.md), [retention holds](76-retention-holds.md), and the [production setup checklist](production-setup.md).
