# Retention holds and destructive work

## Implemented scope

Staff can place durable legal, safety or privacy holds on consumer accounts before a deletion request exists or after account closure. Holds preserve operational review references, not free-form case narratives. A review date means review is due; it never expires or releases the hold. No jurisdictional retention duration or legal conclusion is embedded in code.

An active hold blocks account closure and every new identity-removal dispatch. The account remains active if closure has not occurred; a later hold does not reactivate an already closed account. Holds remain relevant to retained data after identity removal. Policy-driven application/document/storage erasure still needs to be implemented and must use these same controls.

## Staff API

All endpoints require a current staff account and verified MFA. Consumer accounts cannot read or mutate holds, including their own.

| Operation | Endpoint | Permission | Input |
| --- | --- | --- | --- |
| Place | `POST /v1/staff/accounts/:id/retention-holds` | `privacy.hold` | `kind`, `reasonReference`, `reviewAt`; idempotency key |
| Release | `POST /v1/staff/retention-holds/:id/release` | `privacy.release-hold` | `releaseReference`; idempotency key |
| Review queue | `GET /v1/staff/retention-holds` | `privacy.read` | Optional `ownerId`; `status=active` (default) or `released`; paired `afterReviewAt`/`afterId` cursor |

References are bounded opaque identifiers for approved operational records. Store sensitive case details in the controlled case system, not URL parameters or these references. Owners come from the route; extra payload fields cannot change account scope. Placement on a staff account is rejected. Release requires a separate permission from placement or account closure.

The review queue returns at most fifty rows, ordered by review timestamp and ID. Its cursor preserves PostgreSQL timestamp precision. Queue reads and successful mutations are audited. Concurrent duplicate active cases record one hold and audit; a changed review date on that same case requires explicit review instead of silently overwriting evidence. Released records remain available in the released queue. Placement/release evidence is immutable, with one transition to released. A new review can place a new active hold after a previous one was released.

## Provider dispatch boundary

Account closure, hold placement/release and identity dispatch serialize on the account's user-row lock. The identity worker checks holds and commits `identityAttemptedAt` before provider I/O. Network requests run outside database transactions, following the backend transaction guidance. All retries recheck active holds even if an earlier attempt exists.

A hold cannot recall a request already dispatched to Auth0. Hold and closure responses therefore expose both:

- `identityAttemptedAt`: the first committed dispatch; the provider may or may not have completed it. This evidence survives a timeout or failed result-recording transaction.
- `identityRemovedAt`: confirmed absence recorded by the worker. A null value is not proof the identity still exists.

A hold placed after dispatch is effective against later attempts and future retained-data cleanup. It must not suppress truthful confirmation of the earlier attempt. If a prior provider outcome is uncertain, keep the hold and review that attempt before making claims about preserved identity data. Existing historical confirmed-removal records may lack a dispatch timestamp; no historical dispatch times are invented or backfilled.

The database rejects held closure/new first-dispatch writes, changes to recorded dispatch evidence, completion without dispatch evidence for new operations, and destructive edits to hold history. The service enforces holds before every provider retry; direct provider tools and privileged database administration remain outside this application authorization boundary.

The existing outbox retries blocked jobs with bounded backoff and may eventually dead-letter them. Releasing a hold does not itself authorize a provider request or change account state. After review, a staff member with `privacy.close` can use the audited `retry-identity` endpoint to requeue an exhausted identity job. Do not repeatedly retry while the hold remains active.

## Setup and verification

Apply migrations 0041 and 0042 after the consent/closure migrations, before deploying this API. Grant hold placement, release and read permissions only to the intended MFA staff accounts. These hold endpoints are not gated by closure activation, so records can be prepared while `ACCOUNT_CLOSURE_ENABLED=false`. No hosted migration or real hold/provider mutation is implied by local verification.

Local PostgreSQL tests cover pre-request and post-closure holds, overdue review dates, release permission separation, immutable evidence, audit rollback, duplicate retries, precise pagination and the concurrent dispatch/hold boundary. HTTP/runtime tests cover hold placement/release and a blocked then authorized closure. Synthetic provider tests do not prove hosted Auth0 behavior or legal-policy compliance.

## Remaining work

- Implement the policy-driven cleanup manifest and storage/application erasure stages. Each destructive dispatch must recheck holds through `assertNoRetentionHolds` inside its authorization transaction and record durable dispatch/evidence before external work.
- Add staff dashboard review/withdrawal/cleanup controls in the separate dashboard repository, including clear outstanding-provider-attempt presentation and overdue review handling.
- Apply approved retention classes, document versions, message/history handling, retained financial/audit access and backup restoration replay. Final erasure status must account for all required stages and retained-data disclosures.
- Complete owner policy approval and synthetic hosted acceptance before enabling account closure. Do not equate holding records with fulfilling account deletion.

See [account deletion and closure](75-account-deletion.md) for the current workflow and [security/privacy](06-security-and-privacy.md) for retention-policy requirements.
