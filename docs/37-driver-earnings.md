# Recorded driver earnings

## Source and permissions

`GET /v1/drivers/me/earnings` returns allocations from the signed-in driver's `driver_payable` ledger postings. The endpoint inherits authenticated database roles, disabled-account enforcement, read-rate limiting and no-store headers. The query independently rejects rider/staff roles. The owner ID comes from the authenticated actor, never a request parameter.

A completed trip or estimated driver fare does not itself create earnings. Only an allocation journal contributes. The response contains the recorded total and up to 50 recent allocation references, ride references, timestamps and USD amounts. It excludes rider identity, locations, payment instruments and provider/account/customer references. The total includes all allocations, even when only the newest 50 records are shown; one database snapshot supplies both.

## Driver screen

The Drive screen now has separate Trips and Earnings actions. The new Earnings screen uses the shared dark cards, Manrope typography, gold money display and existing status banners. It refreshes while focused/foregrounded and clears records on account change or loading failure. Empty accounts show a truthful explanation rather than estimated or fabricated earnings.

Payout status is explicitly `not_configured`: this is a recorded allocation total, not an available balance, a bank transfer or net income after later adjustments. No cash-out button, payout date, tip or earnings chart is fabricated.

## Verification and remaining work

Five PostgreSQL tests cover estimated-versus-recorded earnings, ownership and serialization, rejected roles, a bounded recent list with a complete total, and excluded non-allocation journal kinds. Driver native/web exports and shared type checks verify compilation; physical-device appearance and real payout reconciliation remain outstanding.

The current list shows the latest 50 records. Full history pagination, date filters, adjustments, refunds/disputes, tips, payout setup/history and actual cash-out policy remain to be implemented. The consumer/internal-dashboard/optional-institution scope remains unchanged.
