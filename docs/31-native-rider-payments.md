# Native rider payment confirmation

## Implemented experience

The rider request flow now opens a payment screen for non-synthetic sessions. The existing ride page also exposes payment confirmation while a searching ride is pending or needs authentication, and no longer describes that unfunded state as an active driver search. The new screen uses shared Rove typography, charcoal cards, route summary, fare and gold actions.

On iOS and Android, `PaymentProvider` initializes Stripe's native PaymentSheet using a public publishable key and the owning rider's server-created session. PaymentSheet collects payment details; Rove does not build a raw card form or send card numbers through its API. The sheet uses the existing Rove colors and a dark appearance. Its native controls retain the SDK's platform typography and accessibility behavior; visual/device acceptance is still required.

A successful sheet response displays that Rove is checking payment. Only refreshed server ride state reports authorization or payment completion. Closing the sheet does not cancel the ride; the rider can return to the ride page to cancel or check status. The controller does not automatically retry confirmation, store client secrets or mark funds as authorized.

## Lifecycle and platform separation

The native provider handles initial URLs and subsequent `rove-rider://payment` callbacks through Stripe. The return route includes the ride id, allowing the payment page to load authoritative status after a bank-app return or cold start. No client secret is deliberately added to Rove's return URL or persistent journal. Never log incoming callback URLs; providers may include sensitive query parameters.

The payment controller checks whether its account/screen is still current after session loading and sheet initialization, before presenting the sheet, and after confirmation. Abandoned results do not update an unrelated screen. A provider-level guard prevents overlapping native payment flows. The page polls only while focused/foreground, fences stale screen generations, and keeps an unresolved booking's existing ride cancellation/recovery route available.

The web implementation excludes the native Stripe provider and explains that payment confirmation requires the iOS/Android app. Missing publishable-key configuration disables native payment entry with a clear message. Synthetic sessions retain the explicit local fixture flow and do not initialize Stripe.

## Current-read requirement

Payment screen state is isolated by signed-in profile and ride id. Returning to the screen clears
retained fare/status until a fresh read arrives. A failed read suppresses payment entry and the
confirmed-payment banner; a mismatched ride response cannot authorize entry. Successful subsequent
reads restore only the actions appropriate to the current server state. These guards complement
server authorization/idempotency and never retry a charge automatically.

## Configuration

Expo selected `@stripe/stripe-react-native` 0.64.0 for SDK 57. The config plugin must receive an options object; the installer-added bare plugin string failed configuration evaluation and has been corrected. Google Pay is disabled and Apple Pay has no merchant identifier configured. Enable wallets only after their account/merchant setup and device verification. [Expo Stripe setup](https://docs.expo.dev/versions/latest/sdk/stripe/)

`apps/rider/.env.example` documents `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Use a publishable key belonging to the same Stripe account/mode as the API. Server restricted/secret keys and webhook secrets never belong in app environment variables. Changing public configuration requires rebuilding/updating the app appropriately. The server must separately compose the payment/customer/session/webhook/worker services and credentials.

## Saved payment methods

The Account payment-methods screen opens Stripe CustomerSheet on native devices. The server authenticates the rider, resolves that rider's Stripe customer binding, and creates a Customer Session scoped to settings. CustomerSheet collects card details directly with Stripe through a SetupIntent; Rove stores neither card numbers nor session client secrets. Setup requests use an idempotency key scoped to the customer binding and request UUID.

Checkout uses a separate Customer Session scoped to the mobile payment element. It allows previously consented payment methods to be displayed; saving and removal are disabled inside checkout and handled through Account settings. Account changes, screen abandonment, and completion invalidate retained native callbacks. A shared guard prevents a payment flow and a settings flow from opening simultaneously.

The server restricted key requires **Customer Sessions: Write** and **Setup Intents: Write** in addition to the existing payment/customer permissions. These are permissions on Rove's sandbox account, not blanket Connect-account access. Configure the matching sandbox publishable key in the rider app. Keep secret keys and webhook secrets on the server. A sandbox permission denial must remain an unavailable-state response; never bypass it with fabricated success or live credentials.

Verify Customer Session creation for both settings and checkout, SetupIntent creation, adding/removing a test payment method in CustomerSheet, and reuse in PaymentSheet. Cancel unconfirmed test SetupIntents and remove temporary customers after provider smoke tests. Unit and browser tests do not prove native card collection or bank authentication.

## Verification and outstanding acceptance

Five controller tests cover submission versus authorization, user dismissal, safe SDK-error handling, abandonment during session loading, and abandonment during initialization/confirmation. Type checking verifies the native SDK integration; local Expo exports compile both apps for iOS, Android and web. These are JavaScript/Hermes exports, not signed binaries or native-device verification.

The staging API and its expected Stripe sandbox account/card configuration have been checked. On the signed iOS simulator build, CustomerSheet opened in TEST mode, saved Stripe’s synthetic card, showed it again after reopening, and removed it successfully with the callback patch below. These checks do not prove ride payment authorization.

Still required: real PaymentSheet and 3DS/bank-app return tests on iOS and Android, cold-start/process-death recovery, wallet setup, native visual/accessibility/large-text review, Android saved-payment-method acceptance, verified receipts/refunds/ledger and final production payment policies. The assistant's Stripe plugin connection does not replace these tests or supply application runtime credentials.

Synthetic native verification confirmed the payment-status screen on iOS and Android. On Android,
removing the local API forwarding hid the retained confirmation and payment entry; restoring the
connection returned the screen to authoritative status. These checks exercise read recovery only,
not Stripe card collection or bank authentication. The shared payment-flow suite includes guards
for wrong-ride data, unavailable reads, authorization and terminal states.

## iOS CustomerSheet callback patch

Stripe React Native 0.64.0 stores a single continuation for each CustomerSheet secret provider.
The staging save/reopen/remove sequence reproduced a native double-resume crash while refreshing
Customer Sessions. The version-pinned pnpm patch coalesces overlapping provider requests and drains
all waiting callbacks once, outside a lock. Reinitialization cancels abandoned waiters. Rove retains
its account/screen callback guards; this patch does not replace authorization or cache secrets.

`scripts/stripe-customer-sheet-native.test.mjs` compiles the installed Swift helper on macOS and
exercises concurrent callers, duplicate completion, subsequent refreshes, cancellation and reentrancy.
`native-smoke/customer-sheet-ios.yaml` exercises a sandbox account with no saved cards, adds the
standard Stripe test card, reopens settings and removes that same card. Run it only against staging
with matching test keys. Native rebuilds are required after installing this patch; an OTA JavaScript
update cannot fix the Swift crash. Reevaluate the patch when upgrading Stripe.

The signed iPhone 17 Pro / iOS 26.5 simulator build passed the full CustomerSheet flow against staging. The original failing removal and a subsequent complete save/reopen/remove cycle both finished without a new crash; test cards were removed. The 31 tooling tests (including the Swift concurrency test), rider typecheck, documentation/format/lint checks, and frozen-lockfile installation passed. This is simulator evidence, not Android or physical-device acceptance.
