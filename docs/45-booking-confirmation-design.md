# Booking confirmation design

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

Implemented September 8, 2026 against the supplied rider Figma frame `5:89`. Design context, generated reference styles and the rendered reference were inspected before implementation.

## Visual implementation

The quote review now uses a centered 15px Manrope Bold header, charcoal route card with 18px corners and 20px padding, exact exported 8px pickup/destination markers, compact 13px summary rows and the reference gold-gradient pill action. Manrope SemiBold is loaded for the summary values. The back glyph is the exported Figma asset inside a 36px circle with a 48px touch target.

The shared Button retains its loading and disabled behavior and now accepts optional container/text styles. Other buttons retain their existing defaults. QuoteConfirmation is a presentation component: quoting, expiry validation, durable booking recovery, payment routing and submission remain in BookingForm.

## Intentional differences

The card shows the returned quote's Standard/Accessible service, estimated trip duration, distance and consumer fare. It does not show recurring schedules, medical coverage, a guaranteed pickup time or an automatic return. Pickup and destination labels make the route direction explicit. The estimate excludes waiting for pickup. Synthetic mode remains visibly labeled. A secondary edit action complements the header back action and clears the quote before returning to route/service selection.

Text wraps and the screen scrolls instead of enforcing the reference's fixed screenshot height. Submission disables both edit actions while the request is pending. The primary action remains “Request ride,” matching the automatic matching flow.

## Verification and remaining work

The local synthetic browser flow was checked at 390×844 and 320×568. Route labels and summary rows wrapped without horizontal clipping; the screen scrolls for remaining content at the smaller size. Header back returned to route/service editing. The 390px rendering is recorded in [confirmation screenshot](screenshots/rider-confirmation-web.png).

Type checks, lint, both apps' iOS/Android/web exports and the existing automated suites were run for this change. This is browser visual and native bundle evidence, not a native-device screenshot or a complete paid trip. Native VoiceOver/TalkBack, large-font/device layouts and payment/booking end-to-end verification remain outstanding.
