# Documentation index

Audited September 12, 2026; source references updated through `cfacf1309c269bb72272e5f0d4661b34f2bb35dd` plus the Android launch smoke checkpoint in [implementation status](18-implementation-status.md). Guides were reconciled against repository scripts/routes/workflows and dated staging observations. No external service configuration or production activation is implied.

## How to read the documentation

Start with implementation status for what is implemented, verified and remaining. Feature guides explain behavior; their old test totals and screenshots are checkpoint evidence, not today's test counts. Architecture and operations documents also contain future requirements. A requirement, SQL file or cloud template is not evidence that it has been deployed or exercised.

Current code is authoritative for callable routes, schemas, configuration and commands: `apps/api/src/app.ts`, `packages/contracts`, `packages/database`, app source, root/package scripts and `.github/workflows`. Check exact-source CI before release. Provider links and dated pricing/limits require fresh verification before a purchase or rollout; this audit makes no new pricing guarantees.

## Guides

| Guide | Role |
| --- | --- |
| [Product scope: consumer ride-hailing with an optional B2B product](01-product-scope.md) | Architecture/scope requirements; implementation limits stated in guide |
| [System architecture](02-system-architecture.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Data model, consistency, and migrations](03-data-model.md) | Architecture/scope requirements; implementation limits stated in guide |
| [API contracts and domain behavior](04-api-and-domain.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Mobile applications and user experience](05-mobile-apps.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Security and privacy architecture](06-security-and-privacy.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Testing strategy and acceptance evidence](07-testing-strategy.md) | Architecture/scope requirements; implementation limits stated in guide |
| [CI/CD, environments, and release controls](08-cicd-and-environments.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Engineering standards](09-engineering-standards.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Delivery plan: core ride-hailing, then optional B2B](10-delivery-plan.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Operations, reliability, recovery, and costs](11-operations-and-costs.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Architecture decision records](12-decisions.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Sources, assumptions, and validation register](13-sources-and-assumptions.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Optional B2B product and cross-repository contract](14-b2b-product-boundary.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Three product repositories and one marketing repository](15-repository-boundaries.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Mobile design contract and approved Figma changes](16-mobile-design-contract.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Scheduling feature flags and rollout plan](17-scheduling-feature-flags.md) | Architecture/scope requirements; implementation limits stated in guide |
| [Implementation status](18-implementation-status.md) | Current checkpoint and explicitly historical ledger |
| [Local development and synthetic ride testing](19-local-development.md) | Feature/runbook; verification is limited to recorded checks |
| [Driver location lifecycle](20-driver-location.md) | Feature/runbook; verification is limited to recorded checks |
| [Continuous integration and dependency safety](21-ci-verification.md) | Feature/runbook; verification is limited to recorded checks |
| [API deployment configuration](22-api-configuration.md) | Feature/runbook; verification is limited to recorded checks |
| [Authenticated API rate limits](23-request-rate-limits.md) | Feature/runbook; verification is limited to recorded checks |
| [Live mobile screen updates](24-live-screen-updates.md) | Feature/runbook; verification is limited to recorded checks |
| [Recovery of interrupted mobile operations](25-operation-recovery.md) | Feature/runbook; verification is limited to recorded checks |
| [Payment provider boundary](26-payment-provider.md) | Feature/runbook; verification is limited to recorded checks |
| [Durable payment webhook ingress](27-payment-webhook-ingress.md) | Feature/runbook; verification is limited to recorded checks |
| [Payment reconciliation and settlement workers](28-payment-reconciliation.md) | Feature/runbook; verification is limited to recorded checks |
| [Durable rider payment sessions](29-payment-session-creation.md) | Feature/runbook; verification is limited to recorded checks |
| [Durable payment customer provisioning](30-payment-customer-provisioning.md) | Feature/runbook; verification is limited to recorded checks |
| [Native rider payment confirmation](31-native-rider-payments.md) | Feature/runbook; verification is limited to recorded checks |
| [Captured funds and earnings subledger](32-captured-funds-ledger.md) | Feature/runbook; verification is limited to recorded checks |
| [Rider payment receipts](33-rider-receipts.md) | Feature/runbook; verification is limited to recorded checks |
| [Backend runtime and deployment boundary](34-backend-runtime.md) | Feature/runbook; verification is limited to recorded checks |
| [Abandoned booking and search expiration](35-search-expiration.md) | Feature/runbook; verification is limited to recorded checks |
| [Vercel worker hosting](36-worker-hosting.md) | Feature/runbook; verification is limited to recorded checks |
| [Recorded driver earnings](37-driver-earnings.md) | Feature/runbook; verification is limited to recorded checks |
| [Rider and driver profile names](38-profile-editing.md) | Feature/runbook; verification is limited to recorded checks |
| [Driver sign-out and tracking cleanup](39-driver-sign-out.md) | Feature/runbook; verification is limited to recorded checks |
| [Rider home Figma alignment](40-rider-home-design.md) | Feature/runbook; verification is limited to recorded checks |
| [Session lifecycle and stale auth responses](41-session-lifecycle.md) | Feature/runbook; verification is limited to recorded checks |
| [Mobile ride history browsing](42-ride-history.md) | Feature/runbook; verification is limited to recorded checks |
| [Booking lookup and route-edit lifecycle](43-booking-request-lifecycle.md) | Feature/runbook; verification is limited to recorded checks |
| [Ride service selection](44-ride-service-selection.md) | Feature/runbook; verification is limited to recorded checks |
| [Booking confirmation design](45-booking-confirmation-design.md) | Feature/runbook; verification is limited to recorded checks |
| [Authentication refresh recovery](46-auth-refresh-recovery.md) | Feature/runbook; verification is limited to recorded checks |
| [Saved places](47-saved-places.md) | Feature/runbook; verification is limited to recorded checks |
| [Driver vehicle submission](48-driver-vehicle-submission.md) | Feature/runbook; verification is limited to recorded checks |
| [Staff vehicle review API](49-staff-vehicle-review.md) | Feature/runbook; verification is limited to recorded checks |
| [Support request intake](50-support-requests.md) | Feature/runbook; verification is limited to recorded checks |
| [Browser journey checks in CI](51-browser-ci.md) | Feature/runbook; verification is limited to recorded checks |
| [Driver trip earnings](52-driver-trip-earnings.md) | Feature/runbook; verification is limited to recorded checks |
| [Recovery after an unmatched search](53-no-driver-recovery.md) | Feature/runbook; verification is limited to recorded checks |
| [Native trip maps](54-native-trip-maps.md) | Feature/runbook; verification is limited to recorded checks |
| [Rider-visible driver location](55-live-driver-location.md) | Feature/runbook; verification is limited to recorded checks |
| [Driver payout onboarding](56-driver-payout-onboarding.md) | Feature/runbook; verification is limited to recorded checks |
| [Payout account events and eligibility freshness](57-payout-account-reconciliation.md) | Feature/runbook; verification is limited to recorded checks |
| [Driver in-app navigation](58-driver-navigation.md) | Feature/runbook; verification is limited to recorded checks |
| [Push notifications](59-push-notifications.md) | Feature/runbook; verification is limited to recorded checks |
| [Neon staging setup](60-neon-staging.md) | Staging configuration and dated provider evidence |
| [Vercel staging](61-vercel-staging.md) | Staging configuration and dated provider evidence |
| [Provider configuration and handoff](62-provider-setup-handoff.md) | Staging configuration and dated provider evidence |
| [Android native verification](63-android-native-verification.md) | Feature/runbook; verification is limited to recorded checks |
| [Rider–driver messaging](64-trip-messaging.md) | Feature/runbook; verification is limited to recorded checks |
| [Driver document upload and review](65-driver-documents.md) | Feature/runbook; verification is limited to recorded checks |
| [Installable staging mobile builds](mobile-staging-builds.md) | Feature/runbook; verification is limited to recorded checks |
| [Production database migrations](production-migrations.md) | Production prerequisite/runbook; no production activation |
| [Production setup and release prerequisites](production-setup.md) | Production prerequisite/runbook; no production activation |
| [Real-time messaging and rider location](realtime-messaging.md) | Feature/runbook; verification is limited to recorded checks |
| [Real staging provider checks](staging-provider-ci.md) | Feature/runbook; verification is limited to recorded checks |

## Repository and asset documentation

Root `README.md`, `CONTRIBUTING.md` and `AGENTS.md` define entry points and contribution rules. Asset READMEs under rider, driver and shared messaging assets retain their Figma export provenance; those dates do not assert current visual parity. They were retained where provenance remains accurate. New completion behavior is described in the design contract and current status.

Secrets, ignored environment files, temporary test outputs and generated dependency documentation are outside this versioned documentation inventory. Never copy them into docs to make setup appear complete.

## Refund tracking

[Refund tracking and recovery](66-refund-tracking.md) covers immutable observations, webhook hints, fair recovery, rider receipt states and staged enablement.

## Staff refund operations

[Staff-authorized refund operations](67-refund-operations.md) documents permissions, durable reservations, provider retries, rollout and remaining financial review/accounting work.

## Refund balance accounting

[Refund balance accounting and correlation recovery](68-refund-accounting.md) covers processor transaction evidence, immutable journals, suspense, lost-response recovery and remaining commercial/release requirements.

## Disputes

[Dispute verification, accounting and staff review](69-disputes.md) covers signed events, current-provider observations, financial journals, staff queue, refund holds and setup/acceptance requirements.

For audited refund/dispute responsibility decisions, see [payment loss allocation](70-payment-loss-allocation.md).

For the unactivated Stripe transfer adapter and required settlement orchestration, see [driver transfer provider boundary](71-driver-transfer-provider.md).
