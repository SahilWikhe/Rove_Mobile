# Live mobile screen updates

Rider ride details, driver active trips and the driver availability screen share `pollWhileForeground`, backed by the independently tested `createPoller` controller. The screen's Expo Router focus effect owns the subscription; blur, unmount or API/session dependency replacement disposes it.

## Behavior

- No reads start while the app is inactive or backgrounded. Returning to active starts an immediate fresh read.
- A screen leaving focus aborts its request and clears its timer. A late response or rejection cannot update that screen through its disposed controller.
- A request must settle before the next scheduled read starts. Slow networks cannot accumulate overlapping polling requests within an active generation.
- Driver availability loads profile, current offers and history in parallel using one cancellation signal.
- Normal intervals are three seconds for driver availability and four seconds for rider/driver trip details. Failure retries back off to at most 60 seconds, extended by a bounded server `Retry-After` when supplied.
- Read recovery clears read errors independently from action errors. A successful poll must not silently erase an unconfirmed cancellation or trip-action error.
- Ride detail updates cannot replace a newer version already in screen state with an older response.

The API client exposes bounded numeric `Retry-After` metadata and forwards cancellation for ride, history and offer reads. It does not automatically retry mutations. Retrying an uncertain booking/transition must preserve its operation key and payload; durable cross-restart command recovery remains separate work.

## Verification and limits

Five controller tests cover paused starts, sequential requests, cancellation, stale response suppression, disposal, backoff and duplicate lifecycle events. Two native-adapter tests cover AppState events and focus cleanup with mocked native subscriptions. API-client tests cover abort propagation and bounded retry metadata. These tests do not prove actual iOS/Android process lifecycle behavior; physical-device background/foreground checks remain required.

This change covers the three live screens named above. Offer countdown, history/account refresh, push/realtime subscriptions, process-death recovery and provider-backed native end-to-end verification remain separate delivery work. Background driver location is intentionally owned by the driver app layout and its scoped native task, not by a screen polling controller.
