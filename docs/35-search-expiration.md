# Abandoned booking and search expiration

## Durable deadline

Ride creation atomically records a `ride.search_expire` outbox job with `available_at` equal to the persisted search deadline. Command retries reuse the ride and deadline job. This uses the current three-minute booking/search window; it does not introduce a separate scheduling product or cancellation fee.

The worker rechecks and locks the ride before expiration. Requests before their deadline, unknown rides and rides that have already left searching are unchanged. At the deadline, a searching ride with verified `authorized` funding becomes `no_driver_found`; an unfunded or otherwise unconfirmed search becomes `cancelled`. Pending offers expire, the ride version advances, and its terminal audit/outbox event commits in the same transaction. Concurrent expiry workers cannot create duplicate transitions.

Expiration preserves the payment state. It must not label a payment as released based solely on a timeout. Existing reconciliation and release handlers obtain current provider state and release an eligible hold using the persisted payment attempt. Captured or uncertain funds require the existing financial reconciliation/review path.

## Payment and assignment races

The ride row lock is shared with assignment and reconciliation. An assignment committed before expiration is preserved. An authorization fetched while the request was searching must recheck the now-cancelled ride under that lock; it queues release rather than resurrecting matching.

A terminal ride with no payment attempt needs no processor release call. Payment-session creation rechecks the ride before persisting an attempt, so a new attempt cannot start after cancellation. An existing attempt with a missing processor reference still retries: a provider request may be in flight or its outcome uncertain. Cross-account/mode references are rejected, not silently treated as absent.

## Recovery and hosting

`SearchExpiry.sweep(limit)` scans a bounded number of expired searches and rechecks each under lock. It recovers historical requests without deadline jobs or missing worker delivery. The runtime exposes this sweep and registers `ride.search_expire`; the local synthetic worker also handles the job.

The deployed worker host must repeatedly drain delayed work and periodically invoke this recovery sweep. The Vercel queue and authenticated recovery hooks are now wired in code; see docs/36-worker-hosting.md. Their cloud delivery is not verified yet. The class and durable jobs do not make an idle Vercel HTTP deployment execute background work on their own.

## Verification

Seven PostgreSQL regression tests cover early/late expiration and the freed rider booking slot, funded no-driver results, concurrent retries and assignment preservation, bounded sweep recovery, an in-flight authorization race, absent versus incomplete payment attempts, and rollback when enqueueing cleanup fails. The existing booking retry test additionally verifies one requested event and one scheduled deadline job at the persisted deadline.

These tests use disposable data and simulated payment retrieval. Real cloud scheduling, native timeout presentation, refund/dispute operations and notification/review delivery still require verification or implementation.
