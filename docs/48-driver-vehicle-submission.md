# Driver vehicle submission

Backend, client and driver vehicle form implemented September 8, 2026. Document uploads, staff review and provider verification remain outstanding. This is not a completed onboarding flow.

## Behavior and boundaries

Migration `0012_driver_vehicle_submissions.sql` adds the driver's latest proposed vehicle, revision, status and submission timestamp. The vehicle includes make, model, year, color, plate, two-letter registration region and requested service. Validation bounds data size and rejects control characters and unknown fields; it is not a vehicle eligibility or registration verification policy.

GET and PUT `/v1/drivers/me/vehicle-submission` operate only on the authenticated driver's submission. PUT takes `vehicle` and `expectedRevision` (null initially). Revision conflicts return 409. An identical pending submission can be retried without creating another revision or audit event. Concurrent different submissions serialize through a driver-row lock.

A changed submission requires the driver to be offline and have no matched, en-route, arrived, in-progress or interrupted ride. The transaction writes a pending submission, clears approval and eligibility expiry, removes stored location and revokes tracking grants. It preserves payout readiness. Unverified vehicle details and requested accessible service never replace the effective vehicle/service shown to riders. Going online remains blocked until the separate review workflow establishes eligibility.

The audit event records the submission revision without duplicating plate/address data into audit metadata. Only the latest submission is stored in this initial module; immutable document/review history and staff decision records remain future work. No client-facing approval endpoint exists. A `pending` status records receipt by the backend, not delivery to an operating staff review queue.

## Verification

Postgres tests cover approval invalidation, tracking revocation, unchanged effective vehicle/service, concurrent submissions, identical retries, online rejection, owner scoping, disabled accounts, role/input restrictions and each active-ride state. The API test verifies driver-only access, strict rejection of approval fields and no-store responses. All tests use disposable synthetic databases with the new migration.

Shared client methods expose reading/submitting, with no automatic mutation replay. Both apps' exports and repository quality checks were run. No production migration or cloud review workflow was executed.

## Driver form

Account now links to Vehicle & review status. The form loads the latest owned revision before editing, validates required fields, offers Standard/Accessible requests and displays a separate review step warning that submission pauses driving approval. Online drivers see a route back to Drive so they can go offline first. Pending/approved/rejected status is shown from the server; no client checkmark grants eligibility.

Duplicate submission taps are guarded synchronously. Account-keyed mounts and focus generations prevent late loads/submission responses from replacing a newer screen state. Reload saved vehicle replaces the draft with the server record. A successful submission also attempts device tracking cleanup; a cleanup failure is reported separately from submission success. Document upload and review staff notifications are not represented as implemented.

The running synthetic driver preview was exercised through Account, empty form validation, completing the fields, review warning, submit and pending status. The backend then reported approved=false and eligible=false with the prior effective vehicle unchanged. This intentionally leaves that disposable demo driver pending until the local synthetic environment is recreated; it does not grant test approval through a public API. Phone-width layout, shared suites, type checks and driver platform exports were checked. Native keyboard, screen-reader and physical tracking cleanup remain unverified.

## Next steps

Refine the driver form against native device behavior. Add secure document intake and an audited staff review API, retaining immutable review history. Real eligibility rules, registration jurisdictions, vehicle-age limits, accessible equipment standards and payout/document provider setup remain launch decisions. Complete native offline/tracking and onboarding end-to-end verification before accepting real drivers.
