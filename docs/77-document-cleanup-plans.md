# Document cleanup plans

## Implemented domain workflow

The server domain can prepare an exact per-document inventory, record an explicit approval, queue one outbox job per object version, track dispatch and verified absence, inspect aggregate progress, and recover exhausted jobs. Migration 0044 stores immutable plans, approvals and version targets. This workflow is tested against disposable local PostgreSQL and synthetic providers. It is not connected to HTTP routes, deployed runtime resources or real S3 credentials.

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

Automatic approval review rejected the proposed next step of connecting irreversible version deletion to staff HTTP routes and production-capable AWS credentials, even behind a default-off flag. That connection was not applied. It requires explicit user approval of the target, role and deletion scope. No cleanup class export, HTTP endpoint, runtime registration, new credential configuration, live listing/deletion or hosted migration was added as a workaround.

The concrete proposed connection is to the existing configured private document bucket/account, restricted to approved exact `driver-documents/inbox/<document-id>/<attempt-id>` and `driver-documents/quarantine/<document-id>/<attempt-id>` versions. Use a separate cleanup AWS role, distinct from the upload/scanner role, with only the required version listing/read/deletion and bucket verification permissions. Do not grant governance-retention bypass. Require an explicit cleanup enable flag and approved policy configuration on HTTP and worker hosts. Keep activation off until migration, upload reconciliation and synthetic hosted acceptance are complete.

## Verification and remaining work

Local tests cover full prepare/approve/outbox execution, manifest/MFA/policy failures, delayed execution, holds before and during discovery and after dispatch, current-permission checks on replay, immutable targets/evidence, approval/result audit rollback, lost-result retry and exhausted-job recovery without interrupting active leases. These tests do not establish real S3 IAM acceptance, a deployed staff API or complete retention-policy fulfillment.

Remaining work includes the approved runtime/staff API connection, review UI, uncertain-write and inbox reconciliation, residual-version rediscovery, marker/copy handling, retained application-data cleanup and backup replay. Apply migration 0044 only as part of the reviewed rollout after migrations 0041–0043. Production activation and policy/commercial decisions remain final handoff items.

See [account deletion](75-account-deletion.md), [retention holds](76-retention-holds.md), and the [production setup checklist](production-setup.md).
