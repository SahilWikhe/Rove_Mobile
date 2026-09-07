# Optional B2B product and cross-repository contract

Status: planned boundary; a B2B repository has not been created and its name is not decided. The existing website remains a third, separate repository.

## Product independence

The main Rove service is consumer ride-hailing. The B2B dashboard is an additional sales/product surface for institutions to arrange or sponsor rides. It has its own backlog, UI, deployment, customer roles, onboarding, and pricing decisions. It can be delayed, disabled or temporarily unavailable without preventing ordinary riders and drivers from using the core platform.

Keep a minimal Rove-only support/dispatch console with the core product. Institutional staff are customers of the service, not platform dispatch administrators. Separate hostnames/login audiences and permissions prevent accidental access to Rove's fleet, all rider records or finance functions.

## Ownership

| Concern | Authoritative owner |
| --- | --- |
| Identity mapping, global driver availability, offers and trips | Core backend in `Rove_Mobile` |
| Pricing, consumer charges, driver payables and settlement | Core backend |
| Core data schema and migrations | `Rove_Mobile` only |
| B2B UI, reporting presentation and organization onboarding experience | B2B repository |
| Server enforcement of organization membership, sponsorship and ride visibility | Optional organization modules in core backend |
| Customer web sessions and API forwarding | B2B thin web backend/proxy, if needed |
| B2B-specific non-authoritative view preferences | B2B code; introduce storage only for a concrete need |
| Marketing | Existing website repository |

An institution dashboard may have its own web server; it must not independently assign drivers, calculate binding fares, mutate ride tables or settle money. It calls the shared API with scoped identity. The core backend never calls the B2B frontend in order to finish a ride.

## Versioned API integration

The core repository owns OpenAPI and transport schemas. When B2B implementation begins, publish a versioned schema/client artifact through a chosen registry or release channel, and pin it in the B2B lockfile. Until that distribution mechanism exists, treat it as a milestone task, not a runnable workspace dependency. No cross-repository filesystem imports or unpinned Git dependencies.

Use additive API changes and a documented compatibility window. A core change publishes a candidate contract; B2B tests its supported contract against the candidate API in an isolated environment. Breaking changes require a staged version migration, not simultaneous merges across repositories. Organization API tests live with the backend even when dashboard tests live elsewhere.

## Access and funding

Consumer riders and drivers are platform accounts; no fake institution is needed for them. Add organizations, memberships, sponsorship authorizations and organization-to-ride associations when the add-on is implemented. Access depends on explicit association and capability; joining an institution does not expose the rider's personal history or give the institution ownership of the driver.

The platform verifies that a coordinator may book for this person under this program and spend this organization's funds. Guest bookings require a defined contact/identity and consent process. A sponsor code alone is not broad access. Once a funded ride is accepted, changing an organization entitlement follows a safe resolution policy and must not silently drop a passenger or switch charges to a personal card.

Prepaid balance and invoicing are optional funding adapters. They use the same ride lifecycle and settlement integrity requirements. Decide the institution's contract before enabling real sponsored rides. A consumer payment failure must not fall back to a sponsor without authorization, or vice versa.

## Isolation and resilience

Use per-organization quotas, paginated reports, bounded booking batches and background exports. An institution uploading a large batch must not exhaust matching/payment capacity for consumers. No bulk direct DB access from the dashboard. Export jobs and URLs require scoped permissions and bounded retention.

If the B2B UI goes down, accepted sponsored trips continue through the core engine. If organization funding is unavailable, new sponsored bookings can fail or wait explicitly while consumer bookings continue. Consumer-only backend startup must not require sponsor configuration or health checks. A core API outage is still a shared dependency: two repositories do not create independent runtime availability.

## Independent CI and deployment

Each repository runs its own checks and releases. Core CI covers no-organization consumer paths plus backend organization contracts when those exist. B2B CI covers customer UI/session/access behavior against a compatible API. Trusted cross-repository tests use synthetic data and scoped credentials, never production DB access or privileged execution of an external PR.

Create a separate Vercel project for the B2B dashboard after its source exists. A B2B release never runs core migrations. A core migration job does not depend on deploying the B2B frontend. Keep a release manifest of deployed API/client versions and run compatibility checks before promoting a dependent frontend.

## Add-on delivery gate

Begin after the core consumer ride loop and operational support are reliable. Founder supplies institutional requirements and a repository name; engineering creates that project when requested. Implement backend organization permissions/funding interfaces, versioned client distribution, then the dashboard. Release only after consumer-independence, cross-organization isolation, compatibility and funded-trip continuation tests pass.
