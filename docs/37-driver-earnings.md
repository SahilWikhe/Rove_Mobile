# Recorded driver earnings

## Source and permissions

`GET /v1/drivers/me/earnings` returns allocations from the signed-in driver's `driver_payable` ledger postings. The endpoint inherits authenticated database roles, disabled-account enforcement, read-rate limiting and no-store headers. The query independently rejects rider/staff roles. The owner ID comes from the authenticated actor, never a request parameter.

A completed trip or estimated driver fare does not itself create earnings. Only an allocation journal contributes. The response contains the recorded total and up to 50 recent allocation references, ride references, timestamps and USD amounts. It excludes rider identity, locations, payment instruments and provider/account/customer references. The total includes all allocations, even when only the newest 50 records are shown; one database snapshot supplies both.

## Driver screen

The Drive screen now has separate Trips and Earnings actions. The new Earnings screen uses the shared dark cards, Manrope typography, gold money display and existing status banners. It refreshes while focused/foregrounded and clears records on account change or loading failure. Empty accounts show a truthful explanation rather than estimated or fabricated earnings.

Payout status is explicitly `not_configured`: this is a recorded allocation total, not an available balance, a bank transfer or net income after later adjustments. No cash-out button, payout date, tip or earnings chart is fabricated.

## Verification and remaining work

Six PostgreSQL tests cover estimated-versus-recorded earnings, ownership and serialization, rejected roles, a bounded recent list with a complete total, excluded non-allocation journal kinds, and rejected malformed/foreign cursors. Pagination also verifies identical timestamps without duplicated records. Driver native/web exports and shared type checks verify compilation; physical-device appearance and real payout reconciliation remain outstanding.

The list now supports Older/Newer navigation in pages of 50. Cursor IDs must belong to the driver; boundaries use the original database timestamp and ID, preserving precision and deterministic ordering. Totals remain lifetime recorded allocations, independent of the selected page. Account/page changes remount the view to discard stale results. New allocations can change the total between requests; return to the newest page to see recent additions.

Adjustments, refunds/disputes, tips, payout history and actual cash-out policy remain to be implemented. Payout onboarding has its own screen; the earnings screen links to it without treating onboarding readiness as withdrawable funds. The consumer/internal-dashboard/optional-institution scope remains unchanged.

## Date filtering

Drivers can apply From/Through dates in `YYYY-MM-DD` format, inclusive of both full UTC days. The API accepts the paired `from` and `through` query parameters; missing, impossible or reversed dates are rejected. Selecting or clearing a range resets pagination. A cursor outside the selected range is rejected rather than silently changing the period.

`recordedTotal` stays the lifetime allocation total. Filtered responses also include `periodTotal`, calculated over the entire selected period before pagination. Both totals and the page share one database snapshot. Calls without a range retain the original response shape. The mobile client rejects filtered responses missing `periodTotal`, so an older deployment cannot silently present lifetime results as a selected period.

The driver screen also links each allocation to its trip details and provides a separate payout-setup action. Date filtering does not change ledger records or payment policy. Local verification covers UTC midnight boundaries, empty ranges, ownership, invalid dates and out-of-period cursors, plus browser filtering/reset and trip-details/payout navigation. The iPhone 17 Pro simulator (iOS 26.5) also passed date entry, selected-period/empty-state display and reset using `native-smoke/driver-earnings-dates.yaml`. The test uses Return to finish each native text field before scrolling. Android interaction and deployed acceptance remain pending.
