# Durable payment customer provisioning

## Implemented flow

`PaymentCustomers.ensure` provisions a provider customer for a verified rider. It checks the actual database role and disabled flag, locks the user to serialize first setup, and inserts a customer binding before contacting the provider. Migration `0009_lovely_winter_soldier.sql` permits an unresolved customer id and adds a creation timestamp to that binding.

The binding UUID determines a stable provider idempotency key. Retries preserve that key and input. Concurrent processes resolve the same binding using the existing rider/source uniqueness constraint. Once mapped, future setup requests reuse the binding without another provider call. An unresolved creation older than 23 hours stops for review rather than risking a new customer after provider idempotency records expire.

The Stripe adapter sends only internal rider and binding UUIDs in metadata. It does not copy profile names, emails, addresses or card details into the request. It verifies the returned customer id, object type, live/test mode and ownership metadata before accepting the mapping. Runtime credentials remain server-only.

If account disablement races the provider response, the service retains the mapping for recovery but rejects continued setup. Mapping conflicts cannot overwrite a different customer. Provider network calls run outside database transactions.

## Session composition

Pass `PaymentCustomers` into the final optional constructor argument of `PaymentSessions`. The session service first verifies the requesting rider owns the ride. If an active, unexpired ride lacks a mapped customer, it invokes provisioning and then rechecks ownership, disablement, deadline and the binding before creating the intent. An unowned ride cannot trigger provider customer creation. The native client never supplies a provider customer id.

When provisioning is intentionally absent, the existing `PAYMENT_PROFILE_REQUIRED` behavior remains. Production composition must wire the configured Stripe adapter, matching account/mode source, customer service and payment-session service together. The synthetic local entrypoint is unchanged.

## Verification and remaining work

Six PostgreSQL tests cover persistence before provider calls, mapping reuse, concurrent setup, uncertain retries, the retention cutoff, actual database role/disablement checks, disablement during a provider call and automatic provisioning through session creation. One adapter test covers minimal request metadata and rejection of mismatched customer responses. These tests use synthetic provider responses and do not create real Stripe customers.

Remaining: real sandbox verification, native PaymentSheet and SCA callbacks, saved-method setup, customer deletion/retention and support-review workflows, runtime secret/configuration wiring, financial ledger/receipts/refunds, driver earnings/payouts and full production verification. A connected assistant plugin is separate from application credentials and is not evidence that a deployed app can reach Stripe.
