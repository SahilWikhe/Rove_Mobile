# Authenticated API rate limits

The API now applies shared PostgreSQL counters after signature verification and before user lookup or billable provider operations. Counters use an atomic upsert and the database clock, so separate API instances share the same limits. Local process memory is not the source of truth.

## Current policy

Limits below apply per verified identity, per named policy, in a 60-second window starting with the first request. They are operational starting values, not customer entitlements.

| Operation | Requests per window |
| --- | --- |
| Places search | 30 |
| Quote creation | 10 |
| Profile signup | 5 |
| Tracking grant issue/rotation | 6 |
| Foreground location heartbeat | 60 |
| Background location upload (per authenticated driver ID) | 60 |
| Other authenticated reads | 1,200 |
| Other authenticated mutations | 120 |

A fixed window permits up to twice its budget across a window boundary. This mechanism bounds routine API use; it is not a precise rolling-window quota or a substitute for provider spending caps. Read and mutation budgets are separate so normal polling does not consume the action budget. Failed validation and repeated commands consume their request budget too; existing domain idempotency still prevents duplicate effects.

When exhausted, the API returns `429`, error code `RATE_LIMITED` and a positive integer `Retry-After` header. A limiter storage failure returns `503` and does not proceed with an unbounded provider call. Clients must not automatically replay mutations with a new idempotency key after throttling or an uncertain response.

## Storage and retention

The key is SHA-256 over the policy and verified provider subject. Background-location counters use the authenticated driver UUID instead of a provider subject, under a separate policy. Renewing the grant cannot reset that driver’s budget. Raw bearer tokens and identity strings are not stored in counters. Hashes are pseudonymous operational data, not an anonymity guarantee. Invalid signatures cannot create counter rows. Counts saturate after the limit; rejected traffic cannot overflow the integer counter.

Versioned migrations add the counter table, constraints and expiry index. Apply them through the controlled migration process before deploying this API version; never during request handling or normal builds.

`RequestLimiter.prune()` deletes at most 1,000 counters expired for more than a day, with row locking that supports concurrent cleaners and active traffic. The production maintenance runner must call it repeatedly until a batch returns fewer than 1,000 rows. The method is implemented; production scheduling remains part of worker composition work.

## Scope and remaining protection

This gate covers `/v1/*` authenticated account APIs. Public liveness and location-only grant routes do not enter the OIDC middleware. Background uploads now authenticate an unexpired grant for an online, enabled driver before allocating their separate upload budget. The stable driver ID owns the counter; unknown, expired, revoked and disabled grants cannot allocate new buckets. The limiter commits separately from location updates, so sample rejection and duplicate delivery cannot roll back consumed budget. HTTP body/schema rejection happens before this service gate; edge controls must cover that traffic too.

After consuming the budget, location updates recheck the grant under the existing transaction locks to handle concurrent rotation, revocation and going offline. Age, accuracy and monotonic-sample validation remain enforced. A throttled upload never refreshes location or matching eligibility. Grant deletion does not consume the upload budget; going offline and account reads use separate budgets.

The native background task persists the `Retry-After` deadline with the location-only grant, skips uploads until that deadline, and then submits a newly received fix. It never stores location samples for replay. Native shutdown and revocation remain available during the pause. The current one-minute server window bounds the client pause to 60 seconds; missing retry metadata defaults to 60 seconds.

Edge/WAF limits for unauthenticated traffic, invalid-token floods, connection/body abuse and IP reputation still need deployment configuration. The API intentionally does not trust arbitrary `X-Forwarded-For` headers as identity. Account-level limits alone cannot prevent abuse across many valid accounts; add platform quotas and monitored provider spending limits before launch.

## Verification

Real disposable PostgreSQL tests prove concurrent-instance enforcement, expiry reset, identity/policy separation, bounded counts and cleanup retention. API tests prove excess maps requests never invoke the provider, retry metadata is returned, unrelated reads remain available and forged tokens do not allocate counters. An injected database failure verifies a safe `503` without credential details.

Payment-session requests now have a separate shared budget of ten per minute per authenticated subject. See [payment sessions](29-payment-session-creation.md) for ownership checks and provider-call protection.

Additional PostgreSQL tests verify concurrent background-upload enforcement, rotation resistance, independent drivers, expiry reset, invalid-grant counter exclusion revocation after exhaustion, revocation racing budget consumption and fail-closed behavior when limiter storage is unavailable. HTTP tests verify `429`, positive `Retry-After`, no-store responses and independent account access. Mocked native task tests verify the persisted pause, fresh-only retry and immediate stop/revocation; physical-device delivery is still unverified.
