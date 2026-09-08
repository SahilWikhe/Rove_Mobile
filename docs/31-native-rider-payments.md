# Native rider payment confirmation

## Implemented experience

The rider request flow now opens a payment screen for non-synthetic sessions. The existing ride page also exposes payment confirmation while a searching ride is pending or needs authentication, and no longer describes that unfunded state as an active driver search. The new screen uses shared Rove typography, charcoal cards, route summary, fare and gold actions.

On iOS and Android, `PaymentProvider` initializes Stripe's native PaymentSheet using a public publishable key and the owning rider's server-created session. PaymentSheet collects payment details; Rove does not build a raw card form or send card numbers through its API. The sheet uses the existing Rove colors and a dark appearance. Its native controls retain the SDK's platform typography and accessibility behavior; visual/device acceptance is still required.

A successful sheet response displays that Rove is checking payment. Only refreshed server ride state reports authorization or payment completion. Closing the sheet does not cancel the ride; the rider can return to the ride page to cancel or check status. The controller does not automatically retry confirmation, store client secrets or mark funds as authorized.

## Lifecycle and platform separation

The native provider handles initial URLs and subsequent `rove-rider://payment` callbacks through Stripe. The return route includes the ride id, allowing the payment page to load authoritative status after a bank-app return or cold start. No client secret is deliberately added to Rove's return URL or persistent journal. Never log incoming callback URLs; providers may include sensitive query parameters.

The payment controller checks whether its account/screen is still current after session loading and sheet initialization, before presenting the sheet, and after confirmation. Abandoned results do not update an unrelated screen. A provider-level guard prevents overlapping native payment flows. The page polls only while focused/foreground, fences stale screen generations, and keeps an unresolved booking's existing ride cancellation/recovery route available.

The web implementation excludes the native Stripe provider and explains that payment confirmation requires the iOS/Android app. Missing publishable-key configuration disables native payment entry with a clear message. Synthetic sessions retain the explicit local fixture flow and do not initialize Stripe.

## Configuration

Expo selected `@stripe/stripe-react-native` 0.64.0 for SDK 57. The config plugin must receive an options object; the installer-added bare plugin string failed configuration evaluation and has been corrected. Google Pay is disabled and Apple Pay has no merchant identifier configured. Enable wallets only after their account/merchant setup and device verification. [Expo Stripe setup](https://docs.expo.dev/versions/latest/sdk/stripe/)

`apps/rider/.env.example` documents `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Use a publishable key belonging to the same Stripe account/mode as the API. Server restricted/secret keys and webhook secrets never belong in app environment variables. Changing public configuration requires rebuilding/updating the app appropriately. The server must separately compose the payment/customer/session/webhook/worker services and credentials.

## Verification and outstanding acceptance

Five controller tests cover submission versus authorization, user dismissal, safe SDK-error handling, abandonment during session loading, and abandonment during initialization/confirmation. Type checking verifies the native SDK integration; local Expo exports compile both apps for iOS, Android and web. These are JavaScript/Hermes exports, not signed binaries or native-device verification.

Still required: a sandbox account/API deployment connection, real PaymentSheet and 3DS/bank-app return tests on iOS and Android, cold-start/process-death recovery, wallet setup, native visual/accessibility/large-text review, saved payment methods, verified receipts/refunds/ledger and final production payment policies. The assistant's Stripe plugin connection does not replace these tests or supply application runtime credentials.
