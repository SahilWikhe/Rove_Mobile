# Security and privacy architecture

Status: required controls and threat model; several are implemented and tested, while operational/provider controls remain launch requirements. See [current evidence](18-implementation-status.md). This document is not a security certification, legal determination, or guarantee against attacks. Owner: engineering lead, with the founder responsible for operational/vendor decisions.

## Assets and trust boundaries

Protect identity/session tokens, home/destination addresses, precise location, driver documents, payment references and staff privileges. Consumer ride reliability and physical safety matter independently of institutional programs. Assistance details, caregiver relationships and healthcare data require additional controls when those optional features are introduced.

Treat mobile/browser input, deep links, provider callbacks, downloaded files, and contributions to public PRs as untrusted. Authentication identifies a caller; authorization checks whether that caller can perform this action on this resource now.

## Threats mapped to controls and tests

| Threat | Required control | Verification |
| --- | --- | --- |
| Rider reads someone else's trip | Resource-level authorization for reads, lists, exports and streams | Two tenants/two riders; guessed ids; pagination and filters |
| Caregiver keeps access after revocation | Fresh grant checks; bounded session/subscription lifetime; cache cleanup | Revoke during active session and replay old link/token |
| Driver accesses old assignments | Current assignment check and tracking-session invalidation | Reassignment followed by old reads/uploads |
| User grants themselves staff role | Server-only role administration; MFA for privileged staff | Mass assignment and forged role claims |
| Double booking or duplicate settlement | Transactions, constraints and idempotent business keys | Parallel requests and replay after uncertain response |
| Token or sensitive data leaks | Redaction, scoped storage, minimal notifications and safe error mapping | Automated log/error/payload inspection |
| Request/SMS/maps abuse | Per-account, per-tenant and IP rate limits; quotas and provider caps | Burst tests; 429 behavior; billable call controls |
| Spoofed location | Session authorization, size/age/accuracy checks, audit | Invalid coordinates, stale epochs, replay and future times |
| Forged provider callback | Raw-body signature validation, timestamp check, receipt uniqueness | Invalid signatures and duplicate/out-of-order deliveries |
| Malicious upload | Private storage, size/type allowlist, scanning before staff access | Fake MIME, oversized files, unauthorized signed-URL requests |
| Dependency/CI compromise | Pinned tooling/actions, least privilege, isolated fork tests | Workflow review, secret scan, dependency review |
| Lost device | Session revocation, encrypted minimal cache, expiry | Logout and expired-session/offline behavior |
| Driver/rider marketplace abuse | Rate limits, eligibility checks, offer deadlines and transactional capacity claims | Spam requests, expired acceptance, offline driver and competing claims |
| Discovery location scraping | No public exact driver discovery endpoint; minimal authorized match disclosure | Unmatched rider enumerates driver ids/location sessions |
| Institution reads personal rides | Explicit sponsorship association plus scoped role | Member has both personal and sponsored rides; personal history stays private |
| B2B disrupts consumer traffic | Bounded batches, per-organization quotas and optional dependencies | Disable add-on/funding; overload reporting; core loop still works |

## Authorization design

The server resolves provider subject to a platform user and checks resource ownership, staff capability, or current accepted assignment. Consumer access never depends on organization membership. For optional B2B requests, additionally verify membership, program entitlement and explicit ride association. Never trust supplied organization ids, fares or staff roles. Institution administrators cannot grant Rove staff privileges or inspect unrelated personal rides.

Define reusable authorization policies by capability and resource; avoid scattered `isAdmin` shortcuts. Default deny. Scope SQL queries before reading rows. Use composite ownership constraints and defense-in-depth RLS where practical, but do not claim RLS exists until migrations and tests prove it.

If RLS is added, use a non-owner/non-bypass runtime role and transaction-local tenant context. Never rely on session-global tenant variables with pooled connections. Test that a reused connection cannot inherit another tenant's scope. RLS does not replace explicit field-level filtering and endpoint policies.

## Sessions and administrator access

The internal dashboard and institution dashboard each live in their own repository with separately scoped secrets and deployments. Neither receives core database or migration credentials. Both use the shared API, which enforces current actor permissions; repository separation and a successful dashboard login do not confer staff authority. Staff policy and audit persistence remain in `Rove_Mobile`.

Use managed authentication, verified token issuer/audience/signature/expiry, key rotation handling and bounded clock skew. Never merely decode a JWT. Require MFA for privileged staff before pilot. Define account recovery and role changes with audit; disable inactive/compromised accounts centrally.

For admin browser sessions, use secure, HttpOnly cookies with an appropriate SameSite policy. Protect cookie-authenticated mutations against CSRF and validate origins. Keep bearer tokens off URLs and logs. CORS uses an explicit environment-aware allowlist; CORS is not authorization and native clients are not secured by it.

Short-lived signed realtime access or file URLs require resource authorization when minted and a defined maximum exposure window. Especially sensitive downloads should pass an authorization check at use time. Revocation behavior and unavoidable TTL windows must be explicit.

## Secrets and environment separation

Database credentials, payment secrets, webhook secrets, identity-provider administration keys and signing credentials stay in scoped secret stores. Mobile/web public environment variables contain only intentional public configuration. Commit an eventual `.env.example` with names and safe placeholders, never real `.env` files, connection URLs or private keys.

Separate development, preview, staging and production identities, database data, provider modes and credentials. A preview must never send real rider messages, initiate live money movement, or read production rider data. Fork PRs receive no privileged secrets. Rotate any credential exposed in chat, source, logs or artifacts through the appropriate provider; do not place historical secrets in documentation.

## Web/API hardening

Use TLS, appropriate security headers for the actual admin framework, restrictive content policy validated against required SDKs, clickjacking protection and explicit cache rules. Personalized API/admin responses must not enter shared public caches. Mark sensitive responses `private, no-store` unless a reviewed alternative is justified.

Validate inputs at transport and domain boundaries, parameterize SQL, enforce request/body/batch limits, paginate results, and set dependency timeouts. Sanitize exported spreadsheet cells against formula injection. Avoid fetching arbitrary user-provided URLs; if required later, implement SSRF controls. Rate limits need a shared or platform-backed mechanism across instances, not just process memory.

## Data minimization and retention

Store assistance requirements necessary to provide a ride; do not build a medical chart. Destinations and appointment patterns can still disclose sensitive information without a diagnosis field. Keep operational free text constrained and discourage clinical content.

Before real-data pilot, approve a retention matrix with owner, purpose, duration, access, deletion behavior and legal-hold exceptions for profile details, ride history, raw GPS, latest location, documents, audit, billing and backups. Development default is synthetic data; prototype GPS can be short-lived with informed tester consent. No invented retention period should be presented as law.

Deletion may anonymize a user profile while retaining legally required financial records. Explain this accurately in product policy. Test exports/deletions, cascading references, retained backups and restored-data deletion replay. Restrict who can retrieve location trails or bulk exports and audit those reads.

## Core operating requirements and optional healthcare programs

Consumer launch still requires approved driver/vehicle processes, insurance/operating decisions, support coverage, payment responsibilities and privacy practices. A healthcare partnership is not a universal consumer launch prerequisite. Evaluate additional healthcare obligations when Rove's actual relationships/data require them; do not treat every consumer destination as automatically establishing HIPAA applicability.

Determine whether Rove acts as a covered entity/business associate for each pilot relationship, and whether the information handled is PHI. Identify every relevant processor, including maps, notifications, observability, support, files, authentication and hosting; assess data flows and required agreements. A vendor's general compliance marketing is not proof the specific service/plan and Rove configuration are covered. [HHS cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html)

Obtain qualified review of transport operating requirements, insurance, accessible-service capabilities, background/vehicle verification, and payment responsibilities. Software can enforce verified status/expiry and record evidence; it cannot confer licensing or insurance. Keep real transport enrollment behind the launch gate, not behind an assumption that successful CI makes operations safe.

## Release evidence

Before consumer pilot, demonstrate ownership/assignment tests, abuse controls, payment/webhook integrity, redacted telemetry, preview isolation, restore, revocation and incident response. Before B2B release, additionally prove cross-organization and consumer-personal-history isolation plus funded-trip continuation when the dashboard is unavailable. Record owner/expiry for exceptions. Critical access or financial-integrity failures block the affected release. A separate repository never substitutes for server-side access control.

## Mobile design privacy and rollout controls

Enforce the [offer data boundary](16-mobile-design-contract.md) in server responses, map data, caches, push and telemetry, not only visual masking. Flag credentials stay server-side; client capability booleans are not authorization. Scheduling flags grant no institution/staff role and cannot cancel existing transport obligations. Test forged overrides, targeting-data minimization and rollback as defined in [scheduling flags](17-scheduling-feature-flags.md).
