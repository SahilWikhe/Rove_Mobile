# Driver transfer provider boundary

Updated: September 12, 2026. This is a locally tested provider adapter, not an enabled settlement workflow or evidence of funds reaching a driver's bank.

## Implemented

`StripeDriverTransfers` implements funding inspection, transfer creation, read-only operation lookup and transfer/reversal inspection. It is composed into the runtime only when the default-off driver transfer flag and its prerequisites are explicitly enabled. The protected orchestration is documented in [driver transfer workflow](72-driver-transfer-workflow.md).

Funding inspection verifies the platform account, test/live mode, persisted rider/payment/ride/attempt references, full manual capture, original charge and its actual USD balance transaction. It requires available charge funds and rejects disputed charges, pending funding, invalid fee arithmetic and PaymentIntents configured for automatic destination transfers or on-behalf-of processing. The unrefunded amount is a funding ceiling, not an authorization or a driver's available earnings.

Creation rechecks funding and the existing Accounts v2 recipient capability/ownership reader. It uses a source charge, deterministic operation group, server-owned correlation metadata and `rove-transfer:<operation UUID>` as its idempotency key. A persisted first-attempt time is mandatory; creation checks its age before provider reads and again before mutation. Future times and attempts at least 23 hours old require review. Callers must never reset that time or replace the operation UUID to retry an uncertain outcome.

Lookup is scoped to destination and exact operation group. Only a complete empty result means absent; duplicate, incomplete or mismatched results fail closed. A recovered record must match its amount, charge, driver, account binding, ride, payment attempt, environment and plausible creation time. Read-only recovery does not depend on today's funding or account readiness, so an already-created transfer can still be observed after eligibility changes. An empty lookup alone never authorizes a replacement transfer.

Returned snapshots contain only normalized identifiers, amounts, timestamps and actual balance movements. Reversal history is fetched in bounded pages (at most 1,000 records), with reference, duplicate, total and financial checks. Concurrently inconsistent histories require retry. Transfer debits and reversal credits retain signed processor fees/net effects. No raw provider error or customer payload is returned.

## Orchestration and remaining rollout

The [durable workflow](72-driver-transfer-workflow.md) now adds authorized reservations, immutable operation inputs/journals, current financial/driver holds, an outbox worker, revision fencing and protected recovery. It persists the first-attempt timestamp before the call, retains unknown reservations and prevents aggregate over-reservation against the same fare. These remain responsibilities of the workflow; the transport adapter alone does not authorize a transfer.

A historical disputed-charge marker currently prevents new transfers even after a dispute closes. Resolving that conservative hold requires a deliberate settlement policy and verified dispute/accounting state, not removing the check blindly. Platform liquidity, payout schedules, cross-border/currency support, loss allocation policy and bank-payout status are separate requirements. The current implementation supports USD platform charges and existing US recipient onboarding only.

The adapter checkpoint activated no flag, migration, hosted resource or provider mutation. The later workflow adds migrations and a default-off flag; neither has been activated in a hosted environment by this work. Final policy and paid setup decisions remain owner handoff items. Hosted CI remains deferred pending billing recovery and must pass before release. Provider sandbox acceptance and eventual physical/mobile payout presentation are still required.

## Local verification

Twelve focused mocked-transport tests cover valid requests, funding and recipient holds, input/source/account/mode isolation, retry cutoff, lost-response recovery, ambiguous history, transfer correlation, signed reversal accounting, pagination limits and error sanitization. They do not contact Stripe or prove provider acceptance. Workspace test/type/build evidence is recorded in [implementation status](18-implementation-status.md).

## Provider references

Stripe's [transfer creation API](https://docs.stripe.com/api/transfers/create) moves funds to a connected Stripe account and accepts source-transaction and correlation fields. Its [transfer listing API](https://docs.stripe.com/api/transfers/list) supports destination and group filtering. [Transfer reversals](https://docs.stripe.com/api/transfer_reversals/object) and [balance transaction types](https://docs.stripe.com/reports/balance-transaction-types) document actual transfer/reversal effects. A transfer is distinct from a bank payout.
