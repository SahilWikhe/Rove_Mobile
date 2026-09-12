# Durable payment webhook ingress

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

## Implemented behavior

`POST /webhooks/stripe` accepts the exact raw body and Stripe signature without a mobile bearer token. A configured `PaymentWebhookInbox` verifies the signature before database access. The Stripe adapter rejects tampering, stale/future signatures, the wrong test/live mode and connected-account events: this endpoint currently supports platform PaymentIntents only.

The endpoint is dependency-injected and returns 503 when not configured. The local synthetic server does not enable it. A successful response means the receipt and reconciliation job committed, not that the rider paid or the driver can start a trip. Configure this endpoint in a deployed runtime only after registering and verifying the `payment.reconcile` handler.

Versioned migration `0006_whole_the_order.sql` creates the inbox. The unique `(source, event_id)` index deduplicates concurrent deliveries across processes. The source is a trusted deployment configuration containing the platform account id and mode, such as `acct_fixture:test`; it never comes from a request header or payload. The verifier's credentials/mode must match that source. Separate projects/environments must not share a production inbox or webhook secret.

Each receipt stores only source, event id/type, PaymentIntent id, provider creation time and receipt time. The transaction inserts one `payment.reconcile` outbox job referencing the receipt UUID with source and intent id. No raw body, client secret, customer contact details or payment credentials enter the receipt or queue. Receipt insertion and enqueue roll back together on failure, allowing provider redelivery to succeed later.

## Event handling

Supported hints are PaymentIntent creation, capturable amount update, action required, processing, failure, success and cancellation. Other correctly signed event types receive 200 without persistence. Refund, dispute and Connect events require their own handlers before those features are enabled; they are not covered by this ingress.

A repeated event with identical minimal references is acknowledged without another job. A repeated event id with conflicting references returns 409. Different event ids enqueue independently regardless of delivery order or provider creation time. The consumer must load the server-owned payment reference and retrieve current provider state; it must never set `authorized` or `paid` based only on an event type. Inbox deduplication does not replace idempotent financial operations, attempt records or a ledger.

Only this exact webhook path allows up to 1 MiB. Other API requests retain their 32 KiB limit. Missing/oversized signatures fail before processing. Responses use the existing safe error envelope and `Cache-Control: no-store`; database errors do not expose credentials or SQL constraint details.

## Verification and remaining work

Six integration tests use independently generated HMAC signatures, the real Stripe SDK verifier, Hono HTTP requests and disposable PostgreSQL. They cover twelve concurrent duplicate deliveries, tampering/mode/account rejection, injected enqueue failure with rollback and successful redelivery, late events, conflicting references, unsupported events, disabled configuration and request limits. The tests do not call Stripe or alter a real account.

Customer provisioning, durable payment sessions, native PaymentSheet/CustomerSheet, saved methods, capture/allocation ledger, receipts, earnings and runtime/worker composition are implemented; see [native payments](31-native-rider-payments.md), [ledger](32-captured-funds-ledger.md), [earnings](37-driver-earnings.md) and [runtime](34-backend-runtime.md). Remaining: complete physical-device PaymentSheet/3DS and sandbox journey acceptance, refund/dispute authorization and journals, actual driver transfers/settlement, periodic reconciliation/review operations, retention and approved production policies. Staging evidence is not production activation.
