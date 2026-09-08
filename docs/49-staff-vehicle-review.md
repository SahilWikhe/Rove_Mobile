# Staff vehicle review API

Implemented September 8, 2026 in the shared backend. The internal dashboard remains a separate repository; no staff UI or production staff account was provisioned here.

## Permissions and endpoints

Migration `0014_staff_vehicle_review.sql` adds explicit staff permissions and immutable vehicle-review decision records. Verified MFA, staff role and `driver.vehicle.review` permission are required; the backend checks enabled-user state against the database. No consumer endpoint grants this permission. Configure the managed identity provider to enforce staff MFA and issue its evidence in API access tokens before granting hosted permissions. Restricted staff access and audited permission provisioning remain deployment requirements.

GET `/v1/staff/drivers/:id/vehicle-submission` reads the current submission and records an access audit. POST `/v1/staff/drivers/:id/vehicle-review` requires an Idempotency-Key plus the submission revision, approved/rejected decision, a reason and (for approval) the verified service. Review reasons are stored privately and are not exposed as rider/driver messages. Shared authentication, no-store responses and database request limits apply.

The reviewer must inspect current evidence before deciding. This API records a human decision; it does not verify registration, insurance, identity, background checks or accessible equipment on its own. Secure evidence upload and document review are still outstanding.

## Verified MFA evidence

The OIDC adapter accepts MFA only after validating the token signature, configured issuer/audience, expiry and required claims. Its signed `amr` claim must be an array containing only strings and the exact case-sensitive value `mfa`, as defined in [RFC 8176](https://www.rfc-editor.org/rfc/rfc8176.html#section-2). Missing or malformed claims, an isolated OTP claim and arbitrary request headers do not satisfy this gate. Consumer sign-in remains available without this staff-only evidence.

The backend passes verified evidence into the domain actor; neither a database permission nor a client-supplied boolean can substitute for it. Both submission inspection and decisions, including idempotent replay, enforce the gate before reading private evidence or returning a prior decision.

This is a backend enforcement contract, not proof of a configured provider. The provider must emit `amr` in access tokens for the Rove API audience; an ID-token-only claim is insufficient. A provider using different assurance claims needs an explicitly reviewed adapter and tests, not a permissive fallback. Native consumer biometric unlock is not staff MFA. Token lifetime, recent-authentication/step-up policy, phishing-resistant methods and staff session revocation still need provider configuration and end-to-end verification.

## Transactional behavior

The decision binds to a pending revision and locks the driver. Online drivers and drivers with active trips cannot be reviewed. A newer submission invalidates an older review screen. Competing decisions cannot both succeed. Idempotent retries return the recorded result without a second decision; permission is checked on every call, including a replay.

Approval copies the reviewed make/model/color/plate and verified service into the effective vehicle. Accessible service cannot be granted when the driver requested only Standard. Approval leaves `drivers.approved=false` and eligibility expiry empty: vehicle review is one prerequisite, not permission to go online. Rejection preserves the prior effective vehicle. Driver-submission and review workflows must remain coordinated with future full eligibility approval.

The decision row, current submission status, effective vehicle change and audit event commit together. A PostgreSQL trigger rejects UPDATE of review decisions. Administrative deletion, retention and least-privilege database roles remain deployment controls; no tamper-proof claim is made against database administrators. Audit metadata records the revision and decision without duplicating review reasons or plate data.

## Verification and outstanding work

Tests cover missing MFA despite granted permission, denied replay after loss of MFA evidence, signed valid/invalid MFA claims, forged request headers, missing permission, consumer self-approval attempts, disabled reviewers, access audit, approval without driving eligibility, identical replay, revoked permissions on replay, stale revisions, concurrent conflicting reviews, unrequested accessible capability and direct-update rejection. An API test checks permission denial before target lookup. Existing migration backfill tests account for the new decision-to-history foreign key.

The full repository suites, type checks and quality checks were run against disposable test databases. Hosted MFA configuration and step-up verification, permission provisioning/revocation audits, document evidence, safe driver-facing rejection guidance, complete eligibility activation and the separate dashboard are still required before production use. No real staff privilege or production review was created.
