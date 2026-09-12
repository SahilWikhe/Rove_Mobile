# Recovery after an unmatched search

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

The rider's `no_driver_found` state now offers three explicit actions: try a new search with the previous route, change the route from scratch, or return home. It extends the existing finding-ride state using shared cards/buttons, as specified in [the mobile design contract](16-mobile-design-contract.md).

## New booking boundary

Trying again opens the booking form with only the previous ride ID in navigation parameters. The form reads that ride through the authenticated API, verifies it is terminal (`no_driver_found`, `cancelled` or `completed`) and copies its pickup/destination. Exact addresses are not passed in the navigation URL. A missing, inaccessible or active source ride produces an error rather than silently copying it. The user can still enter a route manually.

No previous quote, payment intent or booking command is copied. Ride type is explicitly reviewed again; the form starts with the normal Standard default. The user can edit either endpoint before choosing “See your fare.” The quote service resolves authoritative provider places, current routing and pricing again. Only “Request ride” submits a new booking with its normal idempotency/recovery handling. Unresolved prior operations continue to block another submission.

The screen does not promise immediate removal of a bank hold. Search termination and payment release are separate backend operations; bank display timing can differ. Existing search-expiry and payment-reconciliation services retain responsibility for releasing an eligible authorization. The client never marks a hold released or charges again automatically.

## Lifecycle and verification

The source-route read is cancelled when the form unmounts or its account/source changes, and late responses are ignored. The form is keyed by account and source ride. Loading and errors use shared mobile components.

The browser acceptance case waits for the real three-minute search deadline with no online driver. It confirms `no_driver_found` through the API, copies the route, verifies no booking POST occurs on opening the form or reviewing the quote, then explicitly requests a new ride and checks the ID differs. The new ride is cancelled through normal confirmation controls. No terminal-state response mock or shortened production deadline is used. This adds approximately three minutes to the browser CI job.

Browser tests do not prove native-device rendering, real driver supply, bank hold timing or processor settlement. Those remain separate release checks.
