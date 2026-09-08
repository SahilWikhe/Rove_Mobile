# Rider and driver profile names

Both account screens now offer the same name editor, using the shared Manrope typography, card, field, banner and gold action components. This is an extension of the profile/settings flow in [the design contract](16-mobile-design-contract.md), not a legal-identity or driver-document workflow. Exact Figma layout and native appearance verification remain outstanding.

## API and ownership

`PATCH /v1/me` accepts only `expectedProfileId`, `expectedName` and `name`. The server derives the account from the authenticated identity; the expected ID is a stale-session guard, never a target-account selector. It must match the signed-in actor. Only riders and drivers can use this edit.

Names are trimmed, nonempty, at most 100 characters and contain no control characters. Unicode names are supported. Public signup uses the same name validation. Unknown fields are rejected; role, provider subject, disabled status, approval, vehicle and payout data cannot be edited through this endpoint. Disabled-account middleware and an additional database predicate prevent changes to disabled users.

An atomic PostgreSQL comparison permits a save only if the current name matches the name the editor loaded, or already equals the requested value. Two different edits from the same baseline cannot both overwrite each other. A repeated successful save is harmless. Replaying an old edit after a different newer edit returns `409 PROFILE_CHANGED`; the user must reload before making a new decision. No automatic mutation retry or offline queue is added.

The response contains only the saved profile ID, name and role. Existing authenticated mutation limits, request-size bounds and no-store responses apply. Profile names are personal data and must not be included in logs or analytics payloads.

## Mobile behavior

Rider Account and the new Driver Account route share one form. It starts with the current session name, keeps drafts only in screen memory, prevents duplicate submissions and shows success only after backend acknowledgement. Saving updates the session profile, so the greeting and account header use the confirmed name.

“Reload saved name” explicitly replaces the draft with the server value. A failed request preserves the draft and offers this recovery path. The form is keyed by account ID, and delayed response handling cannot write a previous account's profile into a different current session. This does not replace the separate planned authentication callback/session race audit.

The editable name is the name currently shown in profiles and assigned-trip details. It does not approve drivers, change verified legal identity, replace document review or update Stripe details. Driver sign-out and full onboarding/account-management workflows remain separate unfinished work.

## Verification

Real disposable PostgreSQL tests cover rider/driver ownership, unchanged driver approval/payout flags, Unicode and invalid input, forbidden field injection, disabled/staff access, concurrent conflicting writes, repeated success and stale replay. HTTP tests cover authentication, validation, persistence, no-store output and conflict responses. Mobile-client tests cover expected-account/value binding, normalization, input rejection and surfacing conflicts without an automatic retry.

Browser previews with synthetic accounts successfully saved rider and driver names and refreshed the account headers. A second-device edit produced the intended conflict banner; reload replaced the stale draft with the saved server value. This is browser evidence, not native-device acceptance.

No production database migration is needed; this updates the existing profile name column. Real OIDC/device testing and complete account privacy/deletion workflows remain outstanding.
