# Refund and dispute loss allocation

## What is implemented

Verified provider balance movements enter refund or dispute suspense. The staff allocation API resolves the current signed balance into explicitly authorized amounts: release of remaining unallocated rider funds, reduction of remaining unpaid driver earnings, and platform payment-loss expense. No default liability split is selected. Staff must supply a policy reference and amounts that sum exactly to the currently reviewed balance.

The original capture, recorded gross driver earnings and gross platform revenue journals remain immutable. Each decision adds a balanced journal, immutable policy/staff attribution, audit entry and idempotent command result in one transaction. Failed audit or persistence rolls back all of them. Payment-row locks serialize competing financial decisions; different command keys cannot consume the same balance twice. Replays still require current staff permission and MFA.

Positive allocations cannot exceed the ride payment's remaining rider liability or driver payable. They cannot take earnings from another trip. A negative suspense balance after provider reinstatement can restore only that same party's prior allocation for that refund/dispute category. It cannot invent extra earnings or repay another category's loss. Processor fees remain separately recorded; this action does not assign those fees to drivers.

When rider funds have already been released, later full-fare earnings allocation stops for review instead of reallocating the original captured amount. Verified provider facts must be present and no older than five minutes. Provider reconciliation uses the same payment locks; a changed outstanding amount requires a refreshed staff decision.

## Staff API

Both endpoints require an active staff account, verified MFA and explicit `payments.loss.allocate` permission:

- `GET /v1/staff/rides/:id/loss-allocation` returns signed refund/dispute suspense balances, remaining rider funds, remaining driver payable, prior net allocations to each party by loss category, and whether both provider checks are current. This is a financial review snapshot, not a declaration that a transfer is eligible.
- `POST /v1/staff/rides/:id/loss-allocation` accepts the shared `PaymentLossAuthorization` contract and an `Idempotency-Key`. Fields are `kind` (`refund` or `dispute`), `expectedBalanceCents`, `riderFundsCents`, `driverCents`, `platformCents`, and `policyReference`. All nonzero amounts must have the same sign. It returns decision and journal IDs.

The shared `PaymentLossReview` response excludes customer/payment credentials. Source account/mode and ride ownership are resolved in the backend. The separate staff dashboard consumes these contracts; its UI is not part of this repository.

## Rollout and remaining work

Migration 0035 adds the immutable allocation decisions and platform payment-loss account. The generated schema snapshot also catches up to the already-versioned refund/dispute tables; the SQL migration does not recreate them. Apply normal reviewed migrations, never at startup.

`PAYMENT_LOSS_ALLOCATION_ENABLED` defaults false. Enabling requires `PAYMENT_REFUNDS_ENABLED`, `PAYMENT_REFUND_ACCOUNTING_ENABLED`, and `PAYMENT_DISPUTES_ENABLED`. No hosted flag, provider setting or money movement was changed by this implementation.

Before enablement, approve the commercial liability policy, staff permissions and review process, verify provider sandbox cases, and complete driver adjustment presentation and transfer integration. Recorded earnings screens currently show original gross allocations, not an adjusted transferable balance. Dispute evidence handling and settlement holds remain separate requirements. A zero suspense balance does not override an open dispute, an uncertain refund, missing payout eligibility, or an unsettled provider balance. Settlements must serialize their reservations/postings with the same payment lock and use net unpaid payable; transferred earnings cannot be deducted again as unpaid earnings.

GitHub CI is currently blocked by account billing/spending limits. Development and disposable local verification may proceed, but a passing hosted run and physical/provider acceptance remain release requirements. See [disputes](69-disputes.md), [refund accounting](68-refund-accounting.md) and [production setup](production-setup.md).
