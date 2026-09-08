# Driver payout onboarding

## Implemented scope

Driver Account now has a Payout setup screen with status refresh, hosted onboarding launch and support access. Identity documents and bank account fields remain on Stripe's hosted pages; the app does not collect them. Typed contracts restrict returned links to HTTPS on `accounts.stripe.com` or `connect.stripe.com`, without URL credentials or custom ports. Links are single-use secrets: do not persist them in application state storage, analytics, logs or command-result tables.

Authenticated driver-only GET/POST `/v1/drivers/me/payout-setup` provide status and request a new link respectively. POST accepts only an empty JSON object. The client cannot select an account ID, driver ID, country or return URL. Both operations share a database-backed limit of ten requests per minute per identity. Responses are not cacheable. Missing provider configuration reports `unavailable`; no synthetic bank account is implied.

GET re-reads the provider account rather than trusting a redirect or cached success flag. The adapter checks account ID, environment and immutable driver/binding metadata. Both recipient transfer and payout capabilities must be active for `ready`; pending capabilities remain pending. Driver eligibility and money movement are separate: this module never changes `drivers.approved` or `drivers.payout_ready`, transfers funds or marks an earnings allocation paid.

## Durable provisioning

Migration `0020_driver_payout_accounts.sql` adds one driver binding per platform account/mode and a unique provider account per source. Before contacting Stripe, the service persists a binding ID used in immutable account metadata and the provider idempotency key. Concurrent calls and uncertain provider responses reuse this identity. Unresolved provisioning older than 23 hours requires support reconciliation before another create attempt, avoiding a new account after provider idempotency retention might lapse.

A provider reference is retained if disablement races account creation, allowing recovery without provisioning a duplicate. Authorization is checked again before returning sensitive links. Old links already delivered cannot be recalled by a database change; they expire at the provider. The service rejects expired links and implausible lifetimes above 30 minutes. Neither database queries nor mobile response DTOs expose financial identity fields.

Existing account references are verified before generating new links. Changing environment/source does not reuse a different platform's binding. Support reconciliation tooling for ambiguous provisioning remains to be implemented; do not delete unresolved rows or invent a replacement account ID.

## Provider model and activation

The candidate adapter uses the installed Stripe SDK and API version `2026-08-26.dahlia`, Accounts v2 recipient configuration, Express dashboard, US identity country and platform responsibility for fees and losses. It requests recipient `stripe_transfers`, not merchant card processing. This is an explicit US marketplace onboarding candidate, not approval of a production charge/transfer model, commission, payout schedule or business liability. No connected account was created by this implementation.

Configuration in the API environment:

- `STRIPE_CONNECT_ONBOARDING_ENABLED=true` enables the adapter; otherwise onboarding stays unavailable.
- `STRIPE_CONNECT_RETURN_ORIGIN` is the HTTPS origin of this API deployment, without a path, query or credentials. It must serve `/connect/return` and `/connect/refresh`.
- Existing Stripe credentials and mode must match the deployment. Prefer restricted keys with only the required Connect operations enabled.
- Live activation additionally requires `STRIPE_CONNECT_MODEL_APPROVED=recipient-express-platform-responsibility`, after business review of the model. Test mode can exercise the candidate without this live acknowledgement.

Both return pages contain only a fixed link back to `rove-driver://payouts` and instructions to check status or request a fresh link. They reflect no account IDs or supplied URLs, perform no mutation and do not treat a return as success. The app requests each replacement link through its authenticated API. Closing the hosted browser triggers a refresh; a deep-link return also reloads the screen. Manual status refresh is always available.

## Verification and remaining release work

PostgreSQL tests exercise parallel/uncertain provisioning, expiry of unresolved attempts, authorization, disablement races, source separation, invalid/expired links and the absence of automatic driver approval. Adapter tests inspect v2 requests, verify both capabilities and reject cross-account/mode/metadata responses and malicious URLs. HTTP tests check authentication, forbidden caller fields, unavailable-provider behavior and non-reflective return pages. Client tests verify the request body and link validation.

Before real onboarding: enable Connect and Accounts v2 on the intended Stripe sandbox, configure restricted credentials, deploy/migrate an isolated environment, validate the hosted flow and native browser/deep-link return on both platforms, then review the production responsibility model. No hosted migration or Stripe mutation has been performed here.

Remaining delivery requirements include account-event webhook ingestion/reconciliation, ongoing capability revocation, driver eligibility integration, transfers and payout recovery, dashboard access, refunds/disputes and native accessibility/visual checks. The future connected-account management surface should include Stripe's notification banner so changing requirements remain visible. Until these gates are implemented and verified, an account reporting ready on this screen is not a production launch approval.

The workspace passed 312 automated tests, typechecking, lint, API bundle smoke and iOS/Android/web exports. The targeted browser setup test passed. The iPhone 17 Pro / iOS 26.5 synthetic smoke also passed after relaunching the app to load its current routes; [screenshot](screenshots/driver-native-payout-setup.png). These UI checks cover the unconfigured state, not real Stripe-hosted onboarding or bank verification. The reusable local check is `native-smoke/payout-setup.yaml`.

## References

- [Accounts v2 creation](https://docs.stripe.com/api/v2/core/accounts/create)
- [Accounts v2 retrieval](https://docs.stripe.com/api/v2/core/accounts/retrieve)
- [Hosted Account Links v2](https://docs.stripe.com/api/v2/core/account-links/create)
