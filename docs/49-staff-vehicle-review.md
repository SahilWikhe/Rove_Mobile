# Staff vehicle review API

Implemented September 8, 2026 in the shared backend. The internal dashboard remains a separate repository; no staff UI or production staff account was provisioned here.

## Permissions and endpoints

Migration `0014_staff_vehicle_review.sql` adds explicit staff permissions and immutable vehicle-review decision records. Both staff role and `driver.vehicle.review` permission are required; the backend checks enabled-user state against the database. No consumer endpoint grants this permission. Configure managed-provider staff MFA, restricted staff access and audited permission provisioning before granting it in a hosted environment; this commit does not implement those provider controls.

GET `/v1/staff/drivers/:id/vehicle-submission` reads the current submission and records an access audit. POST `/v1/staff/drivers/:id/vehicle-review` requires an Idempotency-Key plus the submission revision, approved/rejected decision, a reason and (for approval) the verified service. Review reasons are stored privately and are not exposed as rider/driver messages. Shared authentication, no-store responses and database request limits apply.

The reviewer must inspect current evidence before deciding. This API records a human decision; it does not verify registration, insurance, identity, background checks or accessible equipment on its own. Secure evidence upload and document review are still outstanding.

## Transactional behavior

The decision binds to a pending revision and locks the driver. Online drivers and drivers with active trips cannot be reviewed. A newer submission invalidates an older review screen. Competing decisions cannot both succeed. Idempotent retries return the recorded result without a second decision; permission is checked on every call, including a replay.

Approval copies the reviewed make/model/color/plate and verified service into the effective vehicle. Accessible service cannot be granted when the driver requested only Standard. Approval leaves `drivers.approved=false` and eligibility expiry empty: vehicle review is one prerequisite, not permission to go online. Rejection preserves the prior effective vehicle. Driver-submission and review workflows must remain coordinated with future full eligibility approval.

The decision row, current submission status, effective vehicle change and audit event commit together. A PostgreSQL trigger rejects UPDATE of review decisions. Administrative deletion, retention and least-privilege database roles remain deployment controls; no tamper-proof claim is made against database administrators. Audit metadata records the revision and decision without duplicating review reasons or plate data.

## Verification and outstanding work

Tests cover missing permission, consumer self-approval attempts, disabled reviewers, access audit, approval without driving eligibility, identical replay, revoked permissions on replay, stale revisions, concurrent conflicting reviews, unrequested accessible capability and direct-update rejection. An API test checks permission denial before target lookup. Existing migration backfill tests account for the new decision-to-history foreign key.

The full repository suites, type checks and quality checks were run against disposable test databases. Staff MFA, permission provisioning/revocation audits, document evidence, safe driver-facing rejection guidance, complete eligibility activation and the separate dashboard are still required before production use. No real staff privilege or production review was created.
