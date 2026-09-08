# Mobile ride history browsing

Implemented September 8, 2026 for the rider My rides and driver Trips routes.

## Behavior

Both routes now consume the existing history continuation cursor. Older trips moves to the next page; Newer trips returns one page; Back to latest trips clears the cursor stack. Each page remains bounded to the API's 20 records, rather than accumulating every trip in memory. Trip dates help distinguish repeated destinations. Selecting a trip continues to use the existing role-specific detail route.

The shared `useRidePage` hook refreshes while the screen is focused and the app is foregrounded, using the existing abortable polling controller and backoff. Returning from trip details triggers a fresh read. Refresh/Retry deliberately restarts the subscription and aborts the previous read. Loading is separate from a confirmed empty result. Failed reads clear the visible page and show an error rather than continuing to display potentially revoked data.

The routes key the browser by account ID and each page by cursor. Signing out or changing accounts removes the prior account's page and navigation stack. Signed-out routes issue no history requests. Backend authorization remains authoritative; frontend state clearing is not a permission check.

No scheduling entry points were added. These routes still use the current shared components; complete Figma styling and native visual acceptance remain separate unfinished work.

## Query boundaries and verification

The existing API orders owned rides by `(created_at, id)` descending, uses an owned ride ID as an opaque continuation boundary and fetches one extra record to determine whether another page exists. The database retains full timestamp precision. A missing or foreign-owner cursor returns an empty page with no continuation; the UI always offers a way back to latest when browsing older pages.

Four new PostgreSQL tests prove:

- 25 rides with identical microsecond timestamps traverse as 20 + 5, with no gaps or duplicates.
- Inserting a newer ride between page requests does not shift the existing continuation window.
- Foreign/missing cursors return no rider or driver records, and staff cannot use the personal-history query.
- Driver history includes only assigned trips and preserves post-trip address/identity redaction. Riders retain access to their own endpoints.

A new mobile client test verifies cursor encoding and preservation of the returned continuation. Existing polling tests cover disposal, cancellation, late-response suppression and backoff. These are query/transport/controller tests; they are not rendered multi-page native interaction tests.

The local rider browser preview was exercised through sign-in → My rides, confirming the loaded empty state and Refresh control. Both mobile apps exported for iOS, Android and web. Complete native pagination interaction, accessibility and Figma visual acceptance remain outstanding. All data used in tests was synthetic in disposable local PostgreSQL; production data was not changed.
