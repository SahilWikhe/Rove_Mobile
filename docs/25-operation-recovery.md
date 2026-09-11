# Recovery of interrupted mobile operations

Bookings, rider cancellation and driver trip transitions now use an account/API-scoped operation journal. This complements the server's actor-scoped idempotency table; it does not replace transactions, resource authorization or active-ride constraints.

## Request lifecycle

1. Validate the operation shape and generate its operation key.
2. Save the key and exact payload before calling the API. If storage fails, send nothing.
3. Send one request. Simultaneous submissions of the same operation share a single in-flight promise.
4. On confirmed success, remove the entry. If cleanup fails, retain/recover the same entry safely through server replay.
5. On connection loss, authentication failure, throttling or server failure, retain the entry. A new quote or different trip version cannot overwrite it.
6. After reopening the app, read the saved entry and present an explicit confirmation action. Loading the app never automatically sends a saved mutation.

The recovery button resends the original payload and key. If the server already committed it, the stored command result is returned. If it never committed, normal current authorization, expiry and state checks apply. Definitive validation/domain rejection (`400`, `404`, `409`, `422`) clears the journal so the user can refresh and review a new action. A `401`, `403`, `429`, transport failure or `5xx` does not establish that the earlier operation failed and therefore retains it.

A committed booking is replayable after its quote expires. A brand-new booking with an expired quote is rejected. For trip transitions, preserve the original expected version even if a later poll shows a newer version; substituting that version under the same key would violate the server fingerprint contract.

## Rider trip reads

The rider trip screen clears its loaded details and cancellation confirmation when refocused or
when the requested ride changes. A failed trip poll closes an open cancellation confirmation and
disables new cancellation until a successful read arrives. Failed refresh after a version conflict
also blocks new cancellation. Recovering a journaled operation continues to use its original key
and payload; it is not replaced with a new cancellation command. Server version checks remain the
final authority when the trip changes between reading and confirming.

## Privacy and storage

The entry contains only a random key and either a quote identifier or a ride identifier/state/version. It contains no address, coordinates, bearer token, card data or quote snapshot. Keys are scoped using a SHA-256 digest of API URL, account identifier and synthetic-mode status.

Native entries use Expo SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. The web development preview uses tab-scoped session storage; it can survive a reload but does not provide durable recovery after closing the tab. Storage failures block new operations rather than silently falling back to memory. Reinstalling an app or clearing its storage may lose the device journal; server history and active-ride constraints remain necessary recovery paths.

Sign-out does not delete an uncertain operation. Another account receives a separate namespace; signing back into the same account can recover it. Corrupt entries block replacement and require support/reconciliation rather than guessing that a prior effect did not happen. A production support resolution flow is still outstanding.

## Verification and remaining work

Eight journal tests cover save-before-send, simulated restart, exact payload/key reuse, different-operation rejection, storage failures, definitive versus uncertain errors, corrupt entries, duplicate taps and transition-version preservation. A real PostgreSQL test confirms committed booking replay after quote expiry while a new key is rejected.

Native process-death/keychain behavior still needs device testing. Offer acceptance/decline, availability changes, payment setup and future scheduling commands still need to adopt durable recovery. API contract and command retention changes must preserve replay compatibility across supported app versions. No payment integration or real-provider verification is implied by this change.
