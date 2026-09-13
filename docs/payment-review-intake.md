# Staff payment-review intake

## Scope and state

The backend now supports durable intake for payment.review_required events, a staff queue, acknowledgment and controlled recovery of historical dead letters. Migration 0088 and the staging intake rollout are verified as described below. Staff Auth0 MFA and dashboard acceptance remain pending. The staff dashboard is maintained in a separate repository; no dashboard UI is included here.

A case preserves an escalation even when later reconciliation releases or pays the ride. Acknowledgment records that staff has taken the case into its support process; it does not resolve the payment discrepancy or authorize capture, refunds, transfers or ledger edits. Continue using the separately permissioned financial workflows for any financial action.

## Delivery and evidence

The consumer validates the exact persisted outbox event, aggregate and payment attempt against the configured Stripe account/mode. It inserts one case keyed by event UUID. Concurrent delivery and retries retain one case and one opening audit record. A later distinct event creates another case even after the earlier one is acknowledged. No consumer-provided text or provider secret is stored in the case.

The case table enables and forces RLS. Runtime reads are limited to the exact backend intake context or a currently enabled staff member with MFA and payments.review permission. Inserts bind the verified event/ride/attempt/source. Acknowledgment can change only its timestamp, staff actor and support reference. No runtime delete policy exists; identity binding clears inherited review contexts.

## Staff API

All routes require authenticated identity, current database-owned payments.review permission and verified MFA. Permission is checked again on retries. Responses are not cacheable.

- GET /v1/staff/payment-reviews returns up to 50 unacknowledged cases, with nextCursor. Pass after with that UUID to continue. Optional includeAcknowledged=true includes acknowledged cases. Ordering is stable UUID order, not urgency order; refresh from the beginning to discover newly arriving events during a paged read.
- POST /v1/staff/payment-reviews/:id/acknowledge accepts only a reference field containing a 3–120 character support/ticket identifier. Do not put personal data or payment secrets in this reference. Repeating the same reference returns the original acknowledgment; a different reference conflicts. Acknowledgments append an audit record and leave funding unchanged.
- POST /v1/staff/payment-review-events/:id/recover accepts an exact historical dead-letter event UUID. It rechecks the persisted event and configured payment source and creates the same deduplicated case with a staff recovery audit. It leaves the original dead letter and error evidence intact; it does not replay any payment operation. Retrying recovery is safe. Use the worker's operational evidence to identify exact review event IDs; do not bulk-replay financial jobs.

Responses expose case and ride IDs, timestamps and the support reference. They omit customer/provider intent identifiers, identities and card data.

## Rollout and rollback

1. Deploy compatible code with PAYMENT_REVIEWS_ENABLED=false. Review events remain pending, without claims/attempts or a worker drain hot loop; other jobs continue.
2. Apply migration 0088_payment_review_intake using the environment's explicit migration procedure and verify restricted runtime grants plus enabled/forced RLS. Never migrate during startup or build.
3. Provision payments.review only to approved staff accounts and verify MFA in the actual Auth0 flow. The consumer signup API cannot grant this permission.
4. Enable PAYMENT_REVIEWS_ENABLED=true for API and worker in staging. Verify a dedicated synthetic event reaches the queue once, permission denial, acknowledgment and recovery of an exact synthetic dead letter.
5. Connect the separate staff dashboard/operational process to the queue. Complete hosted staff MFA acceptance and assign response ownership before production approval.

Rollback disables the flag; preserve cases and audit records. Existing dead letters are deliberately retained until an authorized staff recovery, not automatically erased or silently marked completed. This feature does not send email, Slack or push alerts. Production operational ownership and response expectations remain launch decisions.

## Verification

Restricted PostgreSQL tests cover concurrent delivery, persisted-event/source mismatch, late terminal-ride delivery, acknowledgment retries, source immutability, MFA/current/revoked permissions, disabled staff, pagination, forced RLS, actor-context reset and staff recovery that retains the original dead letter without ledger writes. API tests cover route authentication/authorization, strict input and no-store responses. Runtime tests verify flag validation and preservation of disabled review jobs. Hosted rollout, staff Auth0 MFA and dashboard acceptance remain separate evidence requirements.

## Provider-staging verification — September 13, 2026

Applied migration 0088 to the verified provider-staging endpoint. The restricted application role passed verified TLS and grants for all 48 application tables; all 48 have enabled/forced RLS. Enabled only PAYMENT_REVIEWS_ENABLED on rove-api-staging and redeployed its ready code. Deployment dpl_BunBUKS6kDR6N1qPuxTCtTKkbEBp serves the staging alias. The Vercel production target is the staging project's target, not activation of the real production environment.

One dedicated synthetic review event associated with the previously cancelled/released sandbox fixture completed through the hosted worker and produced one durable case. Restricted service calls verified rider/no-MFA denial, repeated recovery of the exact original review dead letter, acknowledgment retries, unscoped runtime reads returning no cases and zero ledger entries for the fixture. The original dead letter remains intact. A temporary database-only synthetic staff identity supplied service-layer verification; its permission was removed and the identity disabled in cleanup. It has no Auth0 login. This does not prove real staff Auth0 MFA or staff dashboard behavior.

Hosted health returned 200 and anonymous review API access returned 401. Fresh configuration inspection confirmed review intake and read-only refund history enabled, while refund mutation/accounting, Connect/transfers, push and document cleanup remain disabled. No financial work was replayed and no real production setting changed. Private fixture/evidence references remain outside Git. Staff sign-in, dashboard operation, response ownership and production approval remain required.
