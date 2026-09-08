# Engineering standards

These standards apply when implementation begins. Prefer explicit, testable modules over maximum abstraction. Modularity means a change has a clear owner and limited consequences, not that every function needs an interface and separate package.

The core consumer product lives in `Rove_Mobile`; the optional institution dashboard is a separate repository using versioned contracts. Core matching, trips, payments, permissions and database migrations have one owner here. Internal Rove staff UI lives in its own third product repository, separate from both this repository and institution customer tooling. Staff policy, mutations and audit persistence stay in the shared backend here. Consumer use cases must run with the B2B module disabled and without fabricated organization records.

## TypeScript and boundaries

Enable strict TypeScript, unchecked indexed-access protection and explicit optional-property behavior where supported. Parse external values as `unknown`; narrow through schemas. Avoid `any`, double casts and suppression comments. An exception requires a narrow scope, reason and test, not a repo-wide compiler downgrade.

Use discriminated unions for domain outcomes and explicit types for money, time windows, actor context and state transitions. Avoid unvalidated stringly typed status logic scattered through components. Runtime schema validation is required at network, webhook, configuration and persistent offline-data boundaries; TypeScript alone does not validate runtime input.

Expose a small public API per feature/module. Never import `../../another-feature/internal/...` to bypass an interface. Keep domain rules pure where practical. Clock, persistence and provider ports belong at boundaries where substitution makes testing useful. Do not build a generic repository abstraction that hides the SQL constraints and transactions the product depends on.

## Backend coding pattern

A transport handler parses a request, resolves actor context, calls a use case and maps the result to HTTP. The use case authorizes, coordinates domain policy and transactions, and records outbox/audit intent. The repository performs explicit scoped SQL. Provider adapters own SDK-specific retries, error mapping and serialization; use cases decide business retry/reconciliation policy.

Prefer functions and composition over inheritance hierarchies. Name use cases after behavior (`quoteRide`, `requestRide`, `acceptOffer`, `captureFare`, `cancelRide`), not generic CRUD. Separate pricing, matching and settlement policy from provider transports. Avoid hidden global clients with mutable user/tenant context. Do not swallow errors to return a success-shaped payload.

Transactions must cover the complete invariant, not just individual inserts. Avoid network calls inside locks; use durable intents. Retrying a transaction requires idempotent local behavior and bounded attempts. A log line is not an audit event and an audit row is not a durable notification queue.

## Frontend coding pattern

Keep screen composition separate from feature logic and platform adapters. Component props should express meaningful state rather than many independent booleans with invalid combinations. Provide loading, empty, error, permission-denied, stale and pending-sync behavior intentionally.

Use stable scoped query keys and targeted invalidation. Cancel obsolete requests when context changes. Avoid copying server state into multiple stores and synchronizing it with chains of effects. Memoize only for demonstrated referential or performance needs. Measure list/map performance before adding complex optimizations.

Build accessible components from the start. Use semantic elements on web and correct native accessibility roles/labels. Respect reduced motion and dynamic text. Keep secrets and server-only imports out of public bundles with automated checks.

## Error handling and observability

Use stable domain error codes, safe user messages, correlation/request ids, and structured logs. Include tenant/resource identifiers only under the approved telemetry policy; do not log contact details, coordinates, credentials, request bodies or clinical free text by default. Redact provider errors before logging.

Set outbound timeouts, retry only safe/idempotent operations, and distinguish permanent validation failures from transient dependencies. Never retry every 4xx. Surface a recoverable state to the operator when reconciliation is needed rather than silently dropping the request.

## Naming and organization

Use behavior-oriented filenames and consistent casing per platform convention. Keep tests near the feature except cross-service E2E suites. Do not grow catch-all `utils`, `helpers`, `services` or a global `types.ts` into a second application. Extract reusable code after a stable common pattern exists, or when a deliberate security/domain boundary requires it.

There is no arbitrary maximum file length. Split a module when it contains unrelated responsibilities, has multiple reasons to change, or cannot be tested without unrelated setup. Avoid both giant route files and dozens of trivial wrappers that make navigation harder.

## Dependencies and tooling

Pin the runtime/package-manager baseline and use a committed lockfile with frozen installs in CI. Use supported Expo-compatible package versions; native libraries need iOS/Android build evidence. Review dependencies for maintenance, licensing, transitive weight, permissions, data collection and platform support before adding them.

Prefer built-in/platform capabilities when they meet requirements. Wrap vendor APIs at a meaningful boundary, but do not invent an all-purpose portability framework. Keep development dependencies out of production bundles. Do not run install scripts or new remote tools casually in privileged environments.

Group routine upgrades, review majors separately, and fix actionable security issues promptly. Do not use `latest` in reproducible deployment instructions. Capture exact versions at bootstrap rather than embedding quickly stale version claims in this plan.

## Tests and review

Each behavior change includes the right test layer described in [testing](07-testing-strategy.md). Verify unhappy paths and authorization, not just the happy path. Prefer semantic assertions over implementation details; test fakes must preserve the provider boundary contract.

Cross-repository reuse uses a pinned published schema/client version, never filesystem imports or copied business logic. Contract changes document supported mobile, internal-dashboard and B2B consumers. Do not require simultaneous releases to make an API change safe. Apply organization checks to institutional operations without accidentally applying them to unrelated personal rides.

PR descriptions state the problem, resulting behavior, validation and material limitations. Mention schema/API changes, privacy implications and migration/release ordering when relevant. Update architecture decisions when boundaries or providers change. Do not claim a test passed unless it was actually executed successfully.

## Definition of done

- The implemented behavior and failure paths match the agreed acceptance criteria.
- Runtime input validation, resource authorization and ownership scoping are present.
- Appropriate tests, boundary checks, types, lint and relevant builds pass.
- Database and API compatibility are preserved or a staged migration is documented.
- Loading/error/offline/accessibility states are handled where applicable.
- Logs and metrics allow support without exposing sensitive payloads.
- Documentation and provider/environment requirements reflect the actual change.
- No credentials, production data, generated build directories or unrelated files are included.

Security-critical and money-moving changes receive explicit focused review. This requirement does not create a claim that review eliminates all defects; release evidence and operational recovery still matter.

## Mobile design and feature modules

Use [approved Figma mappings](16-mobile-design-contract.md) and shared native primitives for the new flows. Keep offer/assignment DTOs distinct and safe by construction. Route scheduling decisions through a typed FeatureAccess boundary rather than scattered provider calls or client-only conditions. Document flag owners, defaults, dependencies and cleanup; preserve admitted commitments independently of rollout state. See [flag plan](17-scheduling-feature-flags.md).
