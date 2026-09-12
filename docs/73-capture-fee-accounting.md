# Capture fee accounting

Updated: September 12, 2026. Local implementation behind `PAYMENT_CAPTURE_ACCOUNTING_ENABLED=false`. This does not claim deployed accounting or provider acceptance.

## What is recorded

The original capture journal records the gross fare as platform Stripe clearing and rider funds. A separate `capture_fee` journal debits `processor_fees` and credits `stripe_clearing` by the actual processing fee. Gross fare, agreed driver earnings, platform revenue and approved refund/dispute allocations are not rewritten. An explicitly verified zero fee receives a durable provider balance binding without a zero-value journal.

The provider reader verifies the configured platform, source mode, payment/customer/ride/attempt, full manual USD capture, source charge and balance amount/fee/net arithmetic. Refund and dispute movements are separate; they do not replace the original charge balance. Missing, unexpanded, partial or incompatible captures fail closed. Pending balance transactions can be observed but cannot establish settled fee accounting.

Migration 0038 adds `payment_capture_checks`, source-scoped unique balance bindings and immutable settled facts. Journal, verified binding and audit commit together. Every read reserves a revision before contacting Stripe; an older concurrent response cannot overwrite a newer observation. Duplicate current observations refresh verification without charging the fee again. Once settled, changed charge/balance/amount/fee/net facts or a regression to pending create a durable review hold while retaining the original journal. The hold cannot be cleared by an ordinary retry or direct update. A reviewed correction workflow remains an operational release requirement; this implementation does not invent an automatic write-off or balancing adjustment.

## Jobs and transfer eligibility

When enabled, successful full capture reconciliation enqueues `capture-fee.reconcile` once, including backfill when a previously paid ride is reconciled again. The handler retrieves current provider data and writes the verified fee journal. Unknown/provider failures follow the existing outbox retry/dead-letter behavior.

Worker recovery includes a fair, bounded sweep of up to 100 captured payments, no more than once per hour per payment, excluding review holds. This includes settled records so later inconsistencies can be detected. Recovery runs before transfer sweeps and job draining. The actual provider reads happen in the durable jobs, outside database transactions.

Transfers require a verified fee record no older than five minutes, with the expected gross amount and no review hold. Each new transfer attempt first refreshes capture fees, then refund/dispute records and source funding. The source charge must match the charge bound to the fee record. A failed refresh retains the earnings reservation and prevents a new transfer mutation. Read-only recovery of an already-created transfer remains possible independently of these creation holds. A fee is a platform processing expense; it does not authorize an extra driver deduction.

## Setup and acceptance

1. Apply migration 0038 using the versioned migration process before enabling capture accounting. No startup migration runs.
2. Configure the existing Stripe source/account and a restricted server key that can read the platform account, PaymentIntents and expanded charge balance transactions. Do not place this key in a mobile bundle.
3. Test a full manual capture in the Stripe sandbox. Verify gross, actual fee and net against the provider balance, then repeat reconciliation and prove only one fee journal exists. An actual test-mode zero fee must remain zero; do not insert an estimated live fee.
4. Verify pending balance recovery, provider outage, stale concurrent response, incorrect references, duplicate balance IDs and settled-fact review holds. Check audit and outbox/dead-letter visibility.
5. Set `PAYMENT_CAPTURE_ACCOUNTING_ENABLED=true` only for the intended verified environment. Driver-transfer activation additionally requires this flag and its existing refund/dispute/loss/Connect/model prerequisites. No production activation is implied.

This covers the original capture processing fee only. Transfer, refund and dispute movements have separate reconciliation. Other provider fees, bank payout reconciliation, partial-capture review, commercial policy approval and production/device/provider acceptance remain separate release work. No real Stripe request or money movement is needed by the local tests.

## Local evidence

Tests use disposable PostgreSQL and mocked provider transport. They cover fee and zero-fee accounting, pending/available transitions, immutable changed-fact holds, idempotency, stale reads, source isolation, cross-payment balance reuse, freshness, missing gross capture and audit rollback. An outbox integration test traverses payment reconciliation into fee accounting. Transfer tests prove fee holds preserve reserved earnings and block new mutations. API/runtime/scheduler tests cover opt-in configuration, creation dependencies and recovery ordering. Current executed check results are in [implementation status](18-implementation-status.md).
