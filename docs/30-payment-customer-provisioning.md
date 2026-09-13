# Durable payment customer provisioning

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

## Implemented flow

`PaymentCustomers.ensure` provisions a provider customer for a verified rider. It checks the actual database role and disabled flag, locks the user to serialize first setup, and inserts a customer binding before contacting the provider. Migration `0009_lovely_winter_soldier.sql` permits an unresolved customer id and adds a creation timestamp to that binding.

The binding UUID determines a stable provider idempotency key. Retries preserve that key and input. Concurrent processes resolve the same binding using the existing rider/source uniqueness constraint. Once mapped, future setup requests reuse the binding without another provider call. An unresolved creation older than 23 hours stops for review rather than risking a new customer after provider idempotency records expire.

The Stripe adapter sends only internal rider and binding UUIDs in metadata. It does not copy profile names, emails, addresses or card details into the request. It verifies the returned customer id, object type, live/test mode and ownership metadata before accepting the mapping. Runtime credentials remain server-only.

If account disablement races the provider response, the service retains the mapping for recovery but rejects continued setup. Mapping conflicts cannot overwrite a different customer. Provider network calls run outside database transactions.

## Session composition

Pass `PaymentCustomers` as the `customers` constructor dependency of `PaymentSessions`. The session service first verifies the requesting rider owns the ride. If an active, unexpired ride lacks a mapped customer, it invokes provisioning and then rechecks ownership, disablement, deadline and the binding before creating the intent. An unowned ride cannot trigger provider customer creation. The native client never supplies a provider customer id.

When provisioning is intentionally absent, the existing `PAYMENT_PROFILE_REQUIRED` behavior remains. The implemented runtime composition wires the configured Stripe adapter, matching account/mode source, customer service and payment-session service together. The synthetic local entrypoint is unchanged.

## Verification and remaining work

Six PostgreSQL tests cover persistence before provider calls, mapping reuse, concurrent setup, uncertain retries, the retention cutoff, actual database role/disablement checks, disablement during a provider call and automatic provisioning through session creation. One adapter test covers minimal request metadata and rejection of mismatched customer responses. These tests use synthetic provider responses and do not create real Stripe customers.

Customer provisioning, durable payment sessions, native PaymentSheet/CustomerSheet, saved methods, capture/allocation ledger, receipts, earnings and runtime/worker composition are implemented; see [native payments](31-native-rider-payments.md), [ledger](32-captured-funds-ledger.md), [earnings](37-driver-earnings.md) and [runtime](34-backend-runtime.md). Remaining: complete physical-device PaymentSheet/3DS and sandbox journey acceptance, refund/dispute authorization and journals, actual driver transfers/settlement, periodic reconciliation/review operations, retention and approved production policies. Staging evidence is not production activation.

## Actor transaction preparation

Customer reservation now binds the verified active rider after its existing user lock. An existing rider/source binding is read after conflict-do-nothing rather than requiring an unchanged-row update. This preserves the stable creation ID and concurrent retry behavior while reducing the permissions needed for reservation. Wallet binding reads now verify and lock the active actor in the same transaction as reading the source-specific mapping, both before and after provider I/O. Provider calls remain outside these transactions.

Payment-customer and wallet suites now use a restricted non-owner database role. They verify current database role, disablement during provider calls, stable retries, changed mappings and withholding session secrets. Migration 0066 now enables and forces payment_customers RLS. Active riders read only their own configured-source binding and may reserve only an unresolved customer. Consumers cannot update provider mappings or delete bindings. Reconciliation, refunds, disputes, capture and transfers resolve an exact persisted attempt/ride/intent into a source-specific customer read scope. Confirmed provider-result persistence uses a separate exact binding/result scope, preserving recovery when account closure races provisioning. Provider calls remain outside transactions. These backend-only scopes are never taken from client-supplied identity or provider metadata.

Financial worker suites also use restricted roles. Direct checks verify foreign/unscoped mapping denial, read-only worker access, missing/wrong-source lookup clearing, and no pooled context leakage. Hosted verification of 0066 remains pending; deploy compatible API and worker code before applying this migration. Other financial tables still require their own policies.
