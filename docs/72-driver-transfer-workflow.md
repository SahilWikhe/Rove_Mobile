# Driver transfer reservations and reconciliation

Updated: September 12, 2026. Implemented locally behind a default-off flag. No hosted migration, provider transfer or production enablement is asserted.

## Staff workflow and authorization

The following API operations require an authenticated, active staff user with verified MFA and `payments.transfer` permission:

- `GET /v1/staff/rides/:id/transfers`: list up to 100 operations, newest first.
- `POST /v1/staff/rides/:id/transfers`: authorize `{ amountCents, policyReference }` with an `Idempotency-Key`.
- `POST /v1/staff/rides/:id/transfers/:operationId/cancel`: cancel an unattempted request with an `Idempotency-Key`.
- `POST /v1/staff/rides/:id/transfers/:operationId/recover`: read current Stripe facts and reconcile an existing operation, without creating a transfer.

Amounts, account references and operational state are server-owned. A policy reference records an explicit approved staff decision; the service does not invent a commercial split or payout schedule. Permission is rechecked even for cached command results. Responses contain operation ID, amount, reversal amount, state and timestamps, excluding provider account/customer identifiers. The staff dashboard remains a separate repository consuming these contracts.

## Durable accounting

Authorization locks the payment and ride and verifies a completed full-fare capture, unallocated rider funds resolved, current refund/dispute records, no financial suspense, no pending/unknown refund, no other queued/review transfer, remaining owned driver payable and a bound recipient account. Current driver approval, operating expiry and active user status are conservative holds. Recipient capabilities and source-charge availability are checked freshly by the provider adapter before mutation.

In one database transaction, authorization records the immutable decision, debits `driver_payable`, credits `driver_transfer_pending`, writes the audit entry and enqueues `transfer.execute`. Another request cannot reserve the same earnings. Loss allocation can deduct only the remaining unpaid, unreserved driver liability. Refund authorization is held while a transfer is queued or requires review.

Cancellation is permitted only while queued and before a first provider attempt. It posts the inverse reservation and makes stale worker delivery harmless. Once a first-attempt timestamp exists, cancellation cannot release money whose external outcome may be unknown. The original amount, policy, driver/account binding, first-attempt timestamp and charge cannot be rewritten.

Before each mutation, the worker refreshes refund/dispute observations, verifies the original ledger reservation and current holds, and persists the first-attempt time and charge before contacting Stripe. It reuses the same operation UUID/idempotency key. An uncertain request retains its reservation. After 23 hours, unresolved attempts become `review_required`; no new-key replacement is issued. Read-only recovery can still record an existing transfer after eligibility changes or expiry of the retry window.

Verified Stripe transfer balance transactions debit the pending liability and record the actual platform clearing movement and processor fees. Every balance transaction is bound immutably to one operation and one journal within its provider source. Duplicate observations are idempotent; different observations for the same transaction require review. Revision fencing prevents slower observations from overwriting newer results. Journal, movement binding, provider ID, state and audit changes commit atomically.

Verified reversal credits restore unpaid driver liability and actual platform balance/fee effects. The operation becomes `review_required`, blocking another transfer against that payment until the case is resolved. This implementation does not automatically forgive, redistribute or repay returned funds. Original gross earnings and approved loss adjustments are not rewritten by transfers. Existing capture journals record gross captured amounts; capture-processing-fee reconciliation still needs implementation before claiming parity with the platform Stripe balance. Transfer/reversal fees implemented here do not fill that separate gap.

## Recovery and limits

The recovery scheduler includes a fair bounded sweep of up to 100 eligible operations, no more than hourly per operation. It includes confirmed transfers so later reversals can be observed, and can enqueue a fresh recovery job after an earlier job dead-lettered. It runs with the existing worker recovery schedule; this is periodic provider reconciliation, not a new transfer webhook implementation. Existing worker failures remain visible in outbox/dead-letter records.

A zero suspense balance alone does not authorize settlement. An old dispute marker, expired operating eligibility, unknown refund, changed payout binding or missing provider funds can still hold a transfer. Owner policy must define case resolution, treatment of inactive drivers, retention and payout timing before rollout. The app does not yet present bank-payout progress or provide driver-initiated withdrawals. A confirmed transfer credits the driver's connected Stripe balance; it does not prove a bank deposit.

## Rollout

Apply migrations 0036 and 0037 through the reviewed migration process before deploying code that uses these tables. They add immutable transfer authorizations, the owned pending-liability account and immutable provider movement bindings. No migration runs at application startup. Existing refund-operation guards also query the new reservation table, so migration order matters even when new transfer creation remains off.

`PAYMENT_DRIVER_TRANSFERS_ENABLED=false` is the default. Enabling requires:

- Refund tracking, refund accounting, dispute tracking and loss-allocation flags enabled and verified.
- Existing Connect onboarding configured, including its distinct webhook secret and required live model acknowledgement.
- `STRIPE_TRANSFER_MODEL_APPROVED=separate-charges-and-transfers`, set only after the owner approves this charge model.
- Approved staff permissions, liability/settlement policy, operational review process, capture-fee reconciliation and provider sandbox acceptance.

No paid setup or commercial decision was selected for the user. Production remains disabled. Before release, restore and pass hosted CI, validate the Stripe sandbox workflow and reversal/lost-response cases, verify available balance and account capabilities with the deployed configuration, and complete the separate bank-payout/status and physical-device acceptance work. See [provider adapter](71-driver-transfer-provider.md) and [production setup](production-setup.md).

## Local evidence

Database tests exercise concurrent authorizations/workers, idempotency, owned reservations, cancellation races, permission revocation, unknown outcomes, financial holds, late reversals, stale reads, audit rollback, immutable decisions, missing reservation journals and cross-operation provider transaction reuse. The authenticated HTTP test covers staff permission, authorization, worker confirmation, list and recovery routes. Runtime tests cover default-off dependency/model checks and no startup money movement. Scheduler tests cover inclusion in recovery. Exact completed checks are recorded in [implementation status](18-implementation-status.md); mocks do not establish provider acceptance.
