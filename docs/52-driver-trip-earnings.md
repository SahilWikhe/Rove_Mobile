# Driver trip earnings

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

The driver trip-complete screen now shows a trip-specific earnings summary. It extends the existing charcoal card, gold amount and muted explanatory text used by the shared mobile components. This implements the consumer adaptation of driver Figma frame `2:262` described in [the design contract](16-mobile-design-contract.md); it does not reinstate a 100%-fare or guaranteed payout claim.

## Source and access

`GET /v1/drivers/me/earnings/:id` requires the assigned driver and a completed ride. Other drivers, rider/staff roles, missing trips and active trips receive 404. The response includes only the trip ID, server-owned earnings estimate, recorded allocation amount/time and payout status. Rider identity, addresses, customer IDs and processor identifiers are excluded.

The recorded amount comes from that driver's `driver_payable` postings in allocation journals. A completed trip or paid label alone is insufficient. Before allocation, the recorded amount/time are null and the UI explicitly labels the amount as an estimate. After allocation, it displays recorded earnings. If those amounts differ, the UI directs the driver to support; it does not overwrite the ledger or substitute the estimate. Multiple allocation journals for one trip require review instead of silently summing duplicate payments.

## Mobile behavior

A focused completed-trip summary polls every ten seconds while foregrounded, cancels reads when unfocused, and clears its displayed amount on a read failure. It links to the existing paginated earnings history. Synthetic sessions label both views as test earnings with no payout.

Payout status remains `not_configured`: no available-withdrawal amount or payout date is promised. Stripe Connect onboarding and eligibility reconciliation are implemented separately; actual transfers/payout settlement, refunds and adjustments still require implementation and verification. This summary is gross recorded trip earnings before subsequent adjustments, not a bank balance.

## Verification

Database-backed tests distinguish estimates from allocations, preserve differing recorded amounts, exclude private fields and reject other actors or incomplete rides. The two-app browser journey completes a synthetic trip through shared reconciliation, checks the trip earnings API and rendered summary, opens earnings history and verifies that the completed trip appears there. Browser coverage and native bundle exports do not prove physical-device behavior or real processor settlement.
