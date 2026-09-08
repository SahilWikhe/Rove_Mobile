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
| Other authenticated reads | 1,200 |
| Other authenticated mutations | 120 |

A fixed window permits up to twice its budget across a window boundary. This mechanism bounds routine API use; it is not a precise rolling-window quota or a substitute for provider spending caps. Read and mutation budgets are separate so normal polling does not consume the action budget. Failed validation and repeated commands consume their request budget too; existing domain idempotency still prevents duplicate effects.

When exhausted, the API returns `429`, error code `RATE_LIMITED` and a positive integer `Retry-After` header. A limiter storage failure returns `503` and does not proceed with an unbounded provider call. Clients must not automatically replay mutations with a new idempotency key after throttling or an uncertain response.

## Storage and retention

The key is SHA-256 over the policy and verified provider subject. Raw bearer tokens and identity strings are not stored in counters. Hashes are pseudonymous operational data, not an anonymity guarantee. Invalid signatures cannot create counter rows. Counts saturate after the limit; rejected traffic cannot overflow the integer counter.

Versioned migrations add the counter table, constraints and expiry index. Apply them through the controlled migration process before deploying this API version; never during request handling or normal builds.

`RequestLimiter.prune()` deletes at most 1,000 counters expired for more than a day, with row locking that supports concurrent cleaners and active traffic. The production maintenance runner must call it repeatedly until a batch returns fewer than 1,000 rows. The method is implemented; production scheduling remains part of worker composition work.

## Scope and remaining protection

This gate covers `/v1/*` authenticated account APIs. Public liveness and location-only grant routes do not enter the OIDC middleware. Background uploads retain their existing grant, age, accuracy and monotonic-sample validation, but need a separate upload-rate budget. Revocation must remain available independently of location-upload limits.

Edge/WAF limits for unauthenticated traffic, invalid-token floods, connection/body abuse and IP reputation still need deployment configuration. The API intentionally does not trust arbitrary `X-Forwarded-For` headers as identity. Account-level limits alone cannot prevent abuse across many valid accounts; add platform quotas and monitored provider spending limits before launch.

## Verification

Real disposable PostgreSQL tests prove concurrent-instance enforcement, expiry reset, identity/policy separation, bounded counts and cleanup retention. API tests prove excess maps requests never invoke the provider, retry metadata is returned, unrelated reads remain available and forged tokens do not allocate counters. An injected database failure verifies a safe `503` without credential details.

Payment-session requests now have a separate shared budget of ten per minute per authenticated subject. See [payment sessions](29-payment-session-creation.md) for ownership checks and provider-call protection.
