# Scheduling feature flags and rollout plan

Status: scheduling behind flags is approved September 7, 2026. Vercel Flags is the recommended initial provider, pending a working Hono/Node integration proof and account/budget verification. No service, flag, package or environment variable has been provisioned by this plan.

## Research and provider choice

Vercel offers its own flag provider and integrations with other providers; another vendor is not required just to add scheduling flags. Use one provider initially and wrap evaluation behind a small application port. [Vercel Flags overview](https://vercel.com/docs/flags)

Our core API uses Hono, not Next.js. The documented framework-neutral `@vercel/flags-core` library is the proposed server adapter; do not paste `flags/next` examples into Hono or an Expo bundle. OpenFeature is an alternative if provider portability becomes necessary. The native apps receive evaluated capabilities through our API rather than holding flag-provider credentials. [SDK options](https://vercel.com/docs/flags/vercel-flags/sdks), [core library](https://vercel.com/docs/flags/vercel-flags/sdks/core)

Current docs describe OIDC authentication on Vercel and SDK keys for other environments. Use scoped server credentials and deliberate local environment linking when implementing; never expose those keys or flag-management access to mobile clients. Exact initialization, timeout, update and cache behavior must be proven with the selected pinned SDK version. No claim of instantaneous rollout consistency is made here. [Authentication guidance](https://vercel.com/docs/flags/vercel-flags/sdks)

Pricing checked September 7, 2026: the published Hobby allowance is 10,000 flag requests per billing cycle; Pro is $0.03 per 1,000 requests. Multiple evaluations from the same source within one application request count as one flag request under the current definition. Recheck actual plan, terms and metering before activation; this is not a free-production guarantee. Estimate capability reads and scheduling mutations, not GPS samples. [Limits and pricing](https://vercel.com/docs/flags/vercel-flags/limits-and-pricing)

## Proposed flag registry

These are proposed boolean keys owned by core engineering/product; all default false in production and new environments.

| Key | Permits new work | Prerequisites |
| --- | --- | --- |
| `scheduling-enabled` | Advance one-time ride creation and scheduling entry points | Implemented service-window, funding, quote and dispatch policy |
| `scheduling-weekly-enabled` | New weekly recurring series | Master flag plus tested weekly recurrence |
| `scheduling-monthly-enabled` | New monthly recurring series | Master flag plus tested month-end recurrence |

Effective access also requires authenticated resource permission, supported app/API contract, supported market/service and implementation readiness. A flag is not a substitute for authorization, payment eligibility or driver approval. Enabling a child while the master is off grants nothing. There is no subscription or institutional-membership prerequisite for personal scheduling.

One-time advance booking is included behind the master flag as the conservative interpretation of “anything related to scheduling.” Recurring UI is preserved for later rollout, not part of the initial on-demand launch. Return-trip automation is separate and not enabled by any of these flags.

## API and native integration

1. Define a server FeatureAccess port with a deterministic fake for tests and a Vercel adapter for deployment. Domain recurrence code consumes a validated decision, not provider SDK objects.
2. Proposed authenticated `GET /v1/me/capabilities` returns only effective booleans for schedule creation/weekly/monthly, a contract version, evaluated timestamp and expiry. No rules, credentials, cohort lists, addresses or medical traits are returned. Apply `private, no-store` to prevent shared caching.
3. Native apps keep an actor/environment-scoped in-memory capability snapshot. Refresh on sign-in, foreground/resume and entering a scheduling flow. Proposed maximum UI age is 60 seconds; expired/missing values disable new scheduling entry. Logout clears it. A stale true value can never authorize a write.
4. Re-evaluate access on every new schedule/series or expansion mutation. Unknown flag, provider failure, invalid response or unavailable configuration returns disabled for new work. Return a stable `FEATURE_UNAVAILABLE` domain code (proposed HTTP 403) with safe recovery instructions. Fetch failures also have a visible retry state.
5. After approval, persist the accepted schedule rule/version, timezone, funding authorization references and admission decision with the transaction. Provider calls occur outside database locks. Constrain database writes by current resource state, idempotency and uniqueness inside the transaction.
6. Existing obligations and their execution use persisted business state, not a fresh consumer-creation flag evaluation. This avoids silently abandoning rides on rollout changes or provider outages.

A flag update racing a request cannot promise global atomic cancellation of an already evaluated request. Bound the evaluation-to-commit interval, measure propagation in staging and audit admitted operations. If an incident needs a strict admission stop, use an explicit server-owned admission gate checked within the transaction. Do not pretend a remote boolean alone guarantees that bound.

Provider targeting uses minimum necessary pseudonymous actor ids, trusted environment/market and supported contract capabilities. Do not send GPS, destination, contact details, diagnoses or payer information. Do not accept arbitrary user-supplied targeting or override headers. Production client requests cannot use Flags Explorer to bypass backend checks.

## Off means no new commitments, not abandoned commitments

| Operation when its creation flag turns off | Required behavior |
| --- | --- |
| Create a new schedule/series or add occurrences | Reject with safe explanation; preserve unsent local form for recovery without promising a booking |
| Expand an existing series, extend its end date or change timing/route | Reject while disabled; route urgent existing-trip changes through supported policy/staff |
| View existing schedules, assignments, history, receipts | Continue under normal authorization even if create entry points disappear |
| Cancel one occurrence, cancel future occurrences, shorten/end a series | Continue under policy; disabling a rollout cannot trap a rider in a commitment |
| Driver accepts/executes previously valid assigned scheduled work | Continue eligibility, acceptance, payment and lifecycle checks; expose needed Upcoming/detail views |
| Materialize occurrences already covered by an accepted recurring agreement | Continue bounded idempotent generation and current occurrence eligibility/funding checks; no silent suppression by the creation flag |
| Provider outage | New scheduling fails closed; on-demand booking, active rides and existing commitment handling remain independent |

Accepted recurrence terms must define an explicit end or cancellation condition and a finite rolling generation horizon. A displayed “No end date” is not permission to create infinite rows or promise unlimited funded rides. If a scheduler itself is unsafe, an emergency operational pause is a different incident action: stop affected processing, identify obligations, notify affected users and arrange resolution. Never silently drop them by flipping a UI flag.

## Rollout and change ownership

- Foundation: fake all flags off; core apps start and complete on-demand journeys without flag-provider credentials.
- Before scheduling work: prove core-library initialization/evaluation on Hono, timeouts, local/nonproduction auth, metering and credentials isolation. Lock supported package versions. If the proof fails, keep scheduling disabled and record a revised adapter decision rather than blocking the core launch.
- Scheduling implementation: build hidden UI and tested API/recurrence modules. Complete synthetic sandbox tests before enabling any environment for real bookings.
- Staging: exercise master/weekly/monthly combinations, app restarts, supported older clients, provider outage and rollback with accepted schedules. No production data copied into tests.
- Pilot: approved allowlisted users in a supported market, one-time scheduling first, weekly second, monthly last. Each stage needs actual supply/support and funding readiness. Do not use an uncontrolled random cohort for transport commitments.
- Expansion: record approver, environment, old/new settings, cohort, timestamp, expected effect, rollback owner and evidence. Observe booking failures, due occurrences, missed coverage, generation lag and provider usage. Review or retire temporary rollout flags after a stable general release; retain only deliberate operational controls.

Configure flags in the core API project. Neither dashboard creates a competing source of truth. Staff-only rollout controls belong in the provider's restricted management surface initially; regular support users do not receive global flag-edit permissions. A mobile binary must already contain the feature before a flag can expose it; flags do not replace native/store releases or compatibility testing.

## Required tests

- Truth table: all eight master/weekly/monthly combinations; children never bypass master. No-org consumer flow remains valid.
- API rejects crafted direct scheduling requests, deep-link bypasses, stale capability values and unsupported clients when disabled; proper user/resource authorization still applies when enabled.
- Unknown key, provider timeout, expired snapshot, malformed result and environment mismatch fail closed for new scheduling. Ordinary rides still succeed with the provider unavailable.
- Toggle during form entry, submission, generation and active trip; admitted schedule obligations remain visible, executable and cancellable. No duplicate request or occurrence under retry/concurrency.
- Weekly timezone/DST behavior; monthly 29th/30th/31st and leap years; occurrence preview matches persisted rules; generation horizon stays bounded; edit-one/edit-future boundaries tested.
- Driver offer redaction remains identical for scheduled and immediate rides. Scheduling never reveals medical or payment coverage data in offers.
- Isolation of capability caches by actor/environment; no provider secrets in mobile bundles, URLs, logs or preview artifacts. Production overrides cannot be forged.
- Separate dashboard and older mobile clients tolerate capability additions and rollback. Flag state does not grant staff or institution permissions.

These are requirements for executable tests as features are built, not evidence that the tests or integrations currently exist.
