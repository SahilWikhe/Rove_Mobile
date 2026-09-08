# Rider home Figma alignment

Implemented September 8, 2026. This is an intermediate visual checkpoint, not completion of the mobile apps.

## Source and approved adaptations

The authenticated rider Home now follows [Figma Home 2:12](https://www.figma.com/design/8S3vQl4P3bVTLSKgxPDghv/Rove-Ride-App?node-id=2-12): greeting hierarchy, outlined search, charcoal trip card, multistop gold promo, exact exported route illustration, Manrope weights and pill navigation. Asset provenance is in [the asset readme](../apps/rider/assets/home/README.md). Shared colours now use the frame values documented in [the design contract](16-mobile-design-contract.md).

Consumer overrides remain in effect:

- Greeting uses the signed-in profile, not the Figma example identity.
- Schedule ahead, standing rides and recurring summaries remain absent while scheduling is unavailable.
- The promo opens booking and describes reviewing a fare; it promises no coverage, return, discount or driver guarantee.
- The trip card displays the latest owned ride from the existing newest-first history endpoint, with its real lifecycle state and request date. It does not label a completed trip as paid or invent an ETA. Details open the existing ride route using only its ID.
- A confirmed empty history shows an empty state; loading and failed refreshes have explicit text. A failed refresh retains the last response with a visible warning. This screen is not the authoritative active-trip controller.
- Saved places are still unimplemented and are not replaced with fake medical shortcuts. Messages remains absent until implemented, as permitted by the design contract. These remain future feature work, not completed capabilities.
- Navigation has visible labels and at least 48-unit targets. A footer inside the safe area reserves its own space, so it stays reachable on short screens without overlaying scroll content.

## Implementation and lifecycle

`apps/rider/src/home/rider-home.tsx` owns authenticated home presentation and composes the existing Screen, Card and Copy primitives. The route keys it by profile ID to clear private state on account changes. Reads reuse the existing foreground/focus polling controller with cancellation, disposal and backoff; the history request receives its AbortSignal. The 15-second refresh is read-only. It stops when the route loses focus or the app backgrounds. Booking is always a deliberate navigation action, never an automatic mutation.

The shared Screen accepts an optional footer and content style; existing callers retain their layout defaults. Rider font loading now includes Manrope Regular and ExtraBold. The native gradient uses the installed React Native 0.86 experimental background-image property; web uses CSS backgroundImage. Both were rendered and inspected. The illustration is contained by an explicitly sized aspect-ratio view, with the image filling both dimensions, correcting a native intrinsic-size mismatch found during review.

## Verification

- All eight package typechecks and repository lint passed.
- The mobile-core suite passed all 34 tests, including the reused polling cancellation/backoff and client transport coverage. These are controller tests, not native UI end-to-end tests.
- Rider iOS, Android and web exports passed. Native Android execution remains unverified.
- The running iOS 26.5 iPhone 17 Pro Debug app was reloaded and inspected. [iOS screenshot](screenshots/rider-home-ios.png) shows the authenticated synthetic empty-history state with the final illustration layout.
- Browser checks at 390×844 and 320×568 confirmed text wrapping and scrolling layout. Booking entry points, My rides and Account navigation were exercised. [Web screenshot](screenshots/rider-home-web.png) records the reference-width layout.
- A browser-only intercepted history failure showed the refresh warning. Removing interception and reconnecting restored the normal empty state. No production database or real ride was changed for these checks.

Remaining visual acceptance includes Android screenshots, large native text settings, screen-reader traversal, higher-resolution illustration export and the rest of the rider/driver frames. Saved places, Messages and other missing journeys still need implementation. Do not infer completed provider integration, payments or production readiness from these screenshots.
