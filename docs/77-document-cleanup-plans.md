# Document cleanup plans

## Implemented domain workflow

The server domain can prepare an exact per-document inventory, record an explicit approval, queue one outbox job per object version, track dispatch and verified absence, inspect aggregate progress, and recover exhausted jobs. Migration 0044 stores immutable plans, approvals and version targets. This workflow is tested against disposable local PostgreSQL and synthetic providers. It is connected to staff HTTP routes and the outbox runtime behind an explicit default-off flag. A dedicated staging cleanup role has been provisioned and policy simulations passed. No hosted cleanup settings have been enabled and no S3 files have been deleted.

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
| `GET /v1/staff/documents/:id/upload-inspection?after=<cursor>` | Audit and page unresolved writes under `privacy.read` |
| `POST /v1/staff/documents/:id/cleanup-plans` | Prepare inventory; strict empty JSON body and idempotency key |
| `GET /v1/staff/document-cleanup-plans/:id` | Audited aggregate inspection under `privacy.read` |
| `POST /v1/staff/document-cleanup-plans/:id/approve` | Approve the exact manifest/policy/review/quiescence/time contract |
| `POST /v1/staff/document-cleanup-plans/:id/retry` | Recover exhausted work; strict empty JSON body and idempotency key |

Disabled endpoints return `DOCUMENT_CLEANUP_UNAVAILABLE`; no cleanup provider or handler is constructed. Already queued cleanup jobs reaching a disabled host cannot delete files, but the generic worker may dead-letter them as unknown topics. Keep HTTP/worker activation coordinated and use audited recovery after re-enabling; disabling cannot recall a provider call already dispatched.

## Investigating pending uploads

The upload-inspection endpoint uses the shared `DocumentUploadInspection` response. It requires staff MFA and current `privacy.read`, records an audit in the same transaction and returns the document's reservation expiry/active state, account-access closure state, and at most 100 pending quarantine-write references with dispatch timestamps. Follow `nextCursor` until null; a cursor from another document is rejected. It does not return document bytes, signed links or the owner's identity. Reservation/access state and the page are read from one database snapshot; later pages can change as genuine provider receipts settle.

This is an investigation view, not reconciliation authorization or proof of storage quiescence. Reading it performs no provider operation and cannot settle writes or bypass cleanup barriers. An empty pending page does not establish that legacy/inbox uploads, copies or storage versions are absent. The endpoint currently shares the cleanup feature's default-off availability; no hosted inspection is claimed. The separate staff dashboard can use this contract when integrating cleanup review.

## Dedicated staging role and absence verification

Created CloudFormation stack `rove-document-cleanup-staging` in `us-east-2`, containing only `DocumentCleanupRole`. Its output is `arn:aws:iam::719623059339:role/rove-document-cleanup-staging-DocumentCleanupRole-DSTNRKy7WhVG`. The role trusts only the existing Vercel issuer `oidc.vercel.com/team-7536`, audience `https://vercel.com/team-7536`, and subject `owner:team-7536:project:rove-api-staging:environment:production`. That Vercel target belongs to the staging project; it does not activate Rove production.

`scripts/document-cleanup-template.mjs` consumes verified scope JSON and an IAM Policy Autopilot SDK baseline, narrowing that baseline to the explicitly approved operations: bucket-versioning checks, prefix-restricted version listing and exact-version deletion. It does not attach the uploader policy or grant file-content reads, uploads, unversioned deletion, bucket administration or governance bypass. Generate the baseline from `s3-document-inventory.ts` and `s3-document-erasure.ts`, then invoke `node scripts/document-cleanup-template.mjs <verified-scope.json> <generated-baseline.json>`. Validate the resulting template and review its CloudFormation change set before applying it. Existing OIDC trust validation is reused; the scope input retains the uploader-policy ARN for validation only.

The erasure provider uses complete validated inventories before and after deletion. This avoids depending on HEAD access to quarantined contents or treating a denied HEAD as absence. Malformed, partial, denied and timed-out discovery remains a failure. Runtime inventory and erasure share the dedicated OIDC credentials and close with the runtime. This does not bypass holds or prove upload quiescence.

All operator AWS calls used the verified `claude-agent` user. CloudFormation creation completed; template lint/validation and Access Analyzer validation passed. Readback exactly matched the reviewed trust and sole inline policy, with no managed policies attached. Thirteen IAM policy simulations passed for allowed operations and denied file reads, writes, unversioned deletion, missing/outside prefixes and other buckets. Simulation does not prove a live Vercel OIDC assumption or the full IAM/bucket-policy/S3 operation chain. No objects were accessed or deleted by these checks.

Keep activation off until migrations, upload reconciliation, policy and synthetic hosted acceptance are complete. Bucket policy, deployment environment and hosted migrations were not changed by role provisioning.

## Verification and remaining work

Local tests cover full prepare/approve/outbox execution, manifest/MFA/policy failures, delayed execution, holds before and during discovery and after dispatch, current-permission checks on replay, immutable targets/evidence, approval/result audit rollback, lost-result retry and exhausted-job recovery without interrupting active leases. Runtime tests additionally cover default-off behavior, missing provider/config, distinct role/account requirements, authenticated/MFA routes, unknown request fields, manifest mismatch, failed-provider recovery, worker dispatch and replay. These tests do not establish real S3 IAM acceptance, a deployed enabled staff API or complete retention-policy fulfillment.

Remaining work includes live OIDC/storage acceptance, review UI, uncertain-write and inbox reconciliation, residual-version rediscovery, marker/copy handling, retained application-data cleanup and backup replay. Apply migration 0044 only as part of the reviewed rollout after migrations 0041–0043. Production activation and policy/commercial decisions remain final handoff items.

See [account deletion](75-account-deletion.md), [retention holds](76-retention-holds.md), and the [production setup checklist](production-setup.md).

## Fresh storage inspection

`POST /v1/staff/documents/:id/storage-inspection` accepts an empty JSON object and performs complete fresh inbox/quarantine version discovery. It requires verified staff MFA and `privacy.read`, rechecks authorization after provider I/O, and commits `document.storage_inspected` audit evidence before returning. The response uses `DocumentStorageInspection`: document ID, discovery start/end timestamps, canonical inventory hash, object-version count and separate delete-marker count. It exposes no file contents or signed URLs. Failed or invalid discovery and failed audit persistence do not return successful evidence.

Use this after approved version jobs finish to identify residual or later-created versions. The operation never changes an approved manifest, settles uncertain writes, deletes objects or marks the account erased. An empty inventory is only an observation across the reported discovery interval; it is not an atomic storage snapshot or proof that outstanding writes cannot finish later. Nonempty results require a separately prepared and approved manifest under the existing barriers. Delete markers, external copies, retained application data and restore replay remain separate obligations.

The route shares the default-off cleanup runtime and existing discovery permission. No migration, cloud permission change or live storage request is introduced by this checkpoint. Synthetic database/domain and HTTP tests cover residual detection, empty observations, permission/MFA rejection and revocation during I/O, audit failure, invalid discovery and disabled runtime behavior. Hosted acceptance remains outstanding.
