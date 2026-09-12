# Booking lookup and route-edit lifecycle

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

Implemented September 8, 2026. This changes booking behavior; complete Figma styling remains unfinished.

## Correctness changes

Place-search and quote responses are now guarded by the shared latest-request controller. Starting another lookup, editing an address, changing pickup/destination target, selecting a place or unmounting the booking form cancels the previous request. Late successes, failures and completion callbacks are ignored even if the underlying transport does not honor cancellation. An obsolete lookup cannot replace current suggestions, show an irrelevant error or stop a newer loading indicator.

Editing pickup or destination immediately clears that selected Place and the displayed quote. A fare review is unavailable until both endpoints are selected again. Merely typing a label cannot preserve an old hidden Place as the fare input. A confirmed zero-result search has explicit guidance rather than an unexplained empty list.

The quote client accepts an AbortSignal. Cancellation may still leave an unused quote record on the server if its creation already completed; it does not request a ride, charge a customer or reserve a driver. Server quote expiry remains authoritative. Booking mutations continue through the existing durable operation journal and are not automatically retried by the lookup controller.

The booking form is keyed by signed-in account ID. Its unmount cancels lookup work, and a late booking result cannot navigate a newer account into the previous account's ride. The persisted operation journal remains the recovery mechanism for uncertain booking outcomes. A synchronous submission guard prevents duplicate button callbacks from starting overlapping submissions before React updates the loading state.

## Verification

Three controlled-promise tests cover an older search resolving after a newer destination search, a late failure after editing, and a quote resolving after leaving followed by a successful fresh request. A client test verifies quote cancellation reaches the transport and causes neither a retry nor a booking request. Existing operation-journal and quote-expiration tests remain in the suite.

The synthetic browser flow was exercised through pickup search/selection, destination search/selection and fare review. Change route → Change pickup removed the previous pickup and fare action while retaining the destination. A query with no matching synthetic place displayed the new empty-search message. No ride was requested during this browser check; the displayed fare was a development fixture, not an approved business price.

Package typechecks, lint and the rider iOS/Android/web exports passed. Full native interaction, real Google Places responses, native payment callbacks and the remaining visual design work are still required. Controller tests and synthetic browser verification do not establish those results.
