# Rider payment receipts

## Behavior

`GET /v1/rides/:id/receipt` returns an authenticated rider's own captured-payment record. The receipt contains a ledger journal reference, ride reference, recorded timestamp, quoted fare, captured amount and current ride/payment states. It excludes processor identifiers, customer identifiers, payment secrets and driver earnings. The timestamp describes when the ledger recorded the capture, not a provider capture timestamp.

One database snapshot checks ride ownership and joins the capture journal through its payment attempt and customer binding. A paid status without a capture journal returns `RECEIPT_PENDING`. Multiple capture journals return `RECEIPT_REVIEW` rather than selecting an arbitrary amount. Partial captures show the actual amount and remain distinguishable from the quoted fare. A cancelled ride can still have a captured-payment record requiring review.

The endpoint inherits disabled-account checks, read-rate limits and no-store headers. Drivers, staff, other riders and unknown ride IDs receive no receipt through this consumer endpoint.

## Mobile screen

The rider ride screen links to `/receipt?id=...` for completed rides or recorded paid/review states. The new screen reuses the shared Manrope, dark cards, gold money display and secondary actions specified in the mobile design contract. Foreground polling refreshes current settlement state and stops on blur/background. Account or ride changes remount the screen so the previous receipt is cleared.

The screen explicitly labels captured and quoted amounts and shows pending/error states. It does not claim that a hold is a payment, that a partial capture paid the full fare, or that payment collection has succeeded before the ledger records it.

## Verification and limits

Six real PostgreSQL/API tests cover missing ledger records, correct amounts and safe serialization, authorization boundaries, partial/cancelled captures, duplicate journals and mismatched customer ownership. Shared strict response validation applies in the mobile client. Native bundle exports verify compilation; physical-device layout and real-provider receipt verification remain outstanding.

This is an in-app payment record, not an emailed/downloadable receipt or a tax invoice. Refund, dispute, fee/tax breakdown and tipping views remain to be implemented. The local synthetic API's paid fixture has no financial ledger and therefore correctly shows a pending receipt; it must not fabricate a capture to make this screen look complete.
