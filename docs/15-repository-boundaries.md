# Three product repositories and one marketing repository

Status: selected by the founder on September 7, 2026. This replaces the earlier plan to keep the internal staff dashboard in `Rove_Mobile`. Both dashboard repository names remain TBD; this change documents the split without creating repositories or deploying applications.

## Ownership

| Repository | Owns | Does not own |
| --- | --- | --- |
| `Rove_Mobile` | Rider and driver apps; shared API; domain rules; matching; pricing; payments; staff permissions and operational use cases; database and migrations | Internal or institutional dashboard source |
| Internal dashboard, name TBD | Rove staff UI for driver approval, support, safety and finance; staff sessions and thin API proxy; browser tests and independent releases | Core database access, migration credentials, duplicate ride or payment rules |
| Institution dashboard, name TBD | Optional B2B customer UI, organization administration, sponsored booking and reports; customer sessions/proxy; browser tests and releases | Staff privileges, direct core database access, duplicate ride or payment rules |
| Existing `Rove` | Marketing website | Mobile product backend or operational dashboards |

That is **three product repositories and four repositories overall**. `Rove_Mobile` remains a monorepo for its two mobile apps, API and shared packages. Splitting the dashboards does not require a fourth product repository for the backend.

## One backend, two dashboard clients

Both dashboards call the API owned by `Rove_Mobile`. The internal dashboard may request a driver approval, audited reassignment or refund; the core backend authorizes and executes that operation. UI validation is for usability and never replaces server-side checks.

All authoritative rider, driver, ride, financial and audit data stays under core database ownership. Neither dashboard imports core server/database packages or connects directly to Neon. A thin web server may manage cookies and forward requests; it must preserve the authenticated actor and must not replace every user with a shared administrator credential. Any later storage for non-authoritative UI preferences needs its own explicit design, not access to ride tables.

Staff and institution identities have distinct capabilities and session boundaries. The core API validates identity and current resource permissions for every request, regardless of which UI sent it. Customer administrators cannot call staff endpoints. Staff roles follow least privilege: support, safety and finance need different access. Use staff MFA, secure browser cookies, CSRF defenses, revocation checks and audited privileged actions as defined in [security](06-security-and-privacy.md).

## Contracts and modularity

The core repository owns canonical transport schemas and OpenAPI. Publish versioned client/schema artifacts before the first internal-dashboard integration; each dashboard pins a supported version with its own lockfile. Choose the distribution registry/release channel during implementation. Do not use cross-repository filesystem imports, unpinned Git dependencies or copied business logic.

Keep backend rules in cohesive domain modules. Dashboard repositories organize their UI by feature and keep session/provider adapters separate. Shared branding can use a versioned token package when actual reuse warrants it; sharing every web/native component is not a goal.

Prefer additive API changes. Retain a documented support window for released mobile and dashboard clients. Publish and test candidate contracts before changing consumers; remove old fields/endpoints only after supported clients migrate. Independent repos introduce coordination work, not automatic modularity.

## Testing and releases

- Core CI owns domain, database, API authorization, operational audit, migration and mobile tests, plus compatibility fixtures for supported dashboard clients.
- Internal-dashboard CI owns staff components, sessions, accessibility, browser flows and its build; it exercises a compatible core API with synthetic data.
- Institution-dashboard CI owns its customer-facing equivalents and organization isolation flows when that product is implemented.
- Trusted compatibility checks test candidate core APIs against pinned released clients. Untrusted PRs receive no production credentials, and neither dashboard CI receives core migration credentials.
- Each repository has independent branch protection, dependency updates, previews and release authorization. Record both dashboard SHA/client version and API version for integration evidence.

Only the core release workflow applies core database migrations. Release a compatible API before a dashboard feature that needs it. Existing compatible dashboards need not redeploy on each API release; dashboard-only changes need not build mobile binaries. Each dashboard gets its own hosting project linked to its own repository once source exists.

Normal automated rides must not call either dashboard server to proceed. Verify ride completion during dashboard UI outages. The shared API/database remains a common dependency, and separate repositories do not eliminate that failure mode. Internal-tool outages still impair support and safety response: provide escalation procedures and decide whether new bookings must pause if safe support cannot be maintained.

## Delivery sequence

1. Focus on `Rove_Mobile`: foundation, identity, availability, quotes, matching and the complete rider/driver flow.
2. Build only essential staff tools in the separate internal-dashboard repository during M4, with core staff API/policy in `Rove_Mobile`. Confirm its name before repository creation. Staff support readiness is required before a real-user pilot.
3. Launch and stabilize the consumer product under controlled conditions.
4. Begin the optional institution dashboard in its own repository during B1–B3, after institutional requirements are defined. It is not a prerequisite for consumer signup or booking.

This split changes source ownership, not the need for essential internal operations before launch. See the [delivery plan](10-delivery-plan.md), [CI/CD plan](08-cicd-and-environments.md) and [institution boundary](14-b2b-product-boundary.md).
