# Driver bank-payout history

Updated: September 12, 2026. Implemented locally; provider activation and physical-device acceptance remain pending.

## Driver experience

The driver Payouts screen now separates bank/debit-card payout history from Stripe onboarding readiness. Earnings links to this screen. It shows amounts, current provider status, created dates and estimated arrival dates for pending/in-transit payouts. Paid is labeled “Paid by Stripe” with bank timing context. Failed payouts offer guidance to review Stripe details or contact support. It never automatically creates another payout or treats setup readiness as a deposit.

History refreshes on screen focus, pull-to-refresh and return from Stripe setup. On the web, the existing setup-status refresh also reloads history. A failed refresh clears stale history instead of showing old status as current. Older-page failures retain already-loaded rows with an error. Requests are aborted on blur; responses from a previous focus/session cannot replace current state. Dates are displayed in UTC. Existing dark cards and shared accessible buttons are reused.

## Read-only API and provider boundary

`GET /v1/drivers/me/payout-history?after=po_...` requires an authenticated active driver. The service chooses the payout account from that driver's current source-scoped binding, never from a caller-supplied account or driver ID. Authorization and binding are rechecked after the provider response. Responses have `Cache-Control: no-store` and use shared strict contracts. Invalid cursors are rejected with a client error.

With the feature disabled, the response is `unavailable`. A missing/incomplete account binding is `not_started`. An available empty history means no provider payouts were returned, not zero earnings. Provider failures do not become an empty success.

The Stripe adapter verifies the configured platform and uses the existing Accounts v2 inspection to validate driver/binding metadata and mode. It reads payouts with the connected account scope and a fixed page size of twenty. Capability remediation does not hide historical payouts. Currency, amount, mode, status, ordering, timestamps, duplicate IDs and pagination are validated. Responses omit destination account identifiers, bank details, arbitrary descriptions, failure messages and metadata. Opaque payout IDs support pagination; they grant no cross-account access.

Statuses come from current Stripe records and can change, including paid to failed. A payout may combine multiple transfers. This account-level view does not claim which specific ride reached the bank, and does not book bank-payout balance transactions, create withdrawals, change schedules or send payout notifications. Driver earnings, transfer settlement and bank payout accounting remain distinct.

## Activation and acceptance

- `PAYMENT_BANK_PAYOUTS_ENABLED=false` is the default. Enable only with configured and verified Connect onboarding. This read-only view does not require enabling new transfers.
- Use the existing restricted server key with platform account, Accounts v2 recipient and connected-account payout read access. No mobile key or raw bank data is needed.
- Verify the deployed key can read payouts for the intended connected test account. Check an empty history, pagination, pending/in-transit/paid/failed/canceled states and a later status change. Compare amounts and estimated dates with the Stripe sandbox.
- Validate that another driver, a disabled identity and a changed payout binding cannot receive the account's history. Verify iOS/Android scrolling, large text and return-from-Stripe behavior on physical devices.
- Production activation, payout timing/fees, bank reconciliation and provider acceptance remain release/handoff work. No real provider request or payout was made by the implementation tests.

## Sources

[Stripe payout listing](https://docs.stripe.com/api/payouts/list), [payout status and estimated arrival semantics](https://docs.stripe.com/api/payouts/object), and [connected-account request scope](https://docs.stripe.com/connect/authentication).

## Local evidence

Provider and database tests cover account-scoped reads, privacy projection, pagination, changed statuses, malformed responses, authorization, source isolation and disablement/binding changes during a request. HTTP tests verify authenticated boundaries, cursor errors and private caching. Browser tests cover status presentation, pagination and stale-data clearing separately from setup readiness. Exact completed checks are recorded in [implementation status](18-implementation-status.md).
