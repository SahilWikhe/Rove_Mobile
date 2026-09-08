# Support request intake

Implemented September 8, 2026 for signed-in riders and drivers. This includes request intake, private read access and one staff response with resolution. It is not a staffed support service or emergency channel. Assignment, notification delivery and the separate dashboard queue remain outstanding.

## Mobile behavior

Both Account screens link to Help & support; driver vehicle review links there as well. The shared form loads recent requests before allowing a new submission, requires a category and a 10–2000-character message, and shows a saved reference only after API confirmation. Messages remain in screen memory until submitted; account-keyed mounts prevent draft/history crossover on account change.

A retry of unchanged input reuses the same idempotency key while mounted. The server also returns an identical already-open request when the category/message match, covering a reopened screen or a lost client key. Changing the message represents a different request. On a failed refresh after successful submission, the saved reference remains visible and the user can refresh again. There is no automatic submission retry or promised response time.

Categories are Account, Vehicle, Trip, Payment and Other. This initial input accepts a single-line message, with no attachments. The UI asks users not to include card numbers, passwords or medical details and explains that immediate danger requires local emergency services. A disabled account cannot use this authenticated flow; an out-of-app recovery contact is still a launch requirement.

## API and storage

Migration `0016_support_requests.sql` adds account-owned support requests with open/resolved status, category, message and creation time.

- GET `/v1/support-requests`: latest 50 requests belonging to the authenticated account.
- POST `/v1/support-requests`: strict category/message body and Idempotency-Key; returns the saved request.
- GET `/v1/staff/support-requests/:id`: explicit `support.read` permission, verified MFA and enabled staff account required; records an access audit.

The caller cannot supply an owner, status, reviewer or privileged field. Consumer role and enabled-user state are checked against the database, including command replay. Staff authorization is shared with vehicle review but uses a separate permission. A staff vehicle reviewer does not automatically receive support access.

Transactions lock the owner to serialize concurrent creation, cap open requests at five per account, and commit the saved request, audit and command result together. POST also has a five-per-minute database-backed API limit. Existing identical open requests return their original result without another request or creation audit. Audit metadata includes category, not message text. Request bodies and command results contain private messages and require restricted database access and coordinated retention/deletion; no encryption-at-rest deployment claim is made here.

Resolution is available only through the staff endpoint described below. There is no consumer status mutation, staff queue listing or ongoing conversation thread. Do not release this as staffed support until the full operational workflow and notification delivery are verified. No production support team, inbox or service-level agreement was configured.

## Verification

Real disposable Postgres tests cover concurrent retry, owner isolation, the concurrent open-request cap, disabled-account replay, role spoofing, MFA/permission denial, audited staff access, strict payload validation and transactional rollback. API tests verify no-store responses, strict ownership input, retry and rate limiting; client tests verify payload validation and propagation of the mutation key.

The driver web preview was exercised at 390×844: Account → Help & support → load → select Vehicle → submit a synthetic question → receive reference and view saved request. Both mobile apps were exported for iOS, Android and web. Physical-device keyboard, screen-reader and native support submission checks remain pending.

## Staff response and resolution

Migration `0017_support_resolution.sql` adds the public response, resolution timestamp and private resolving-staff foreign key. POST `/v1/staff/support-requests/:id/resolve` accepts a strict `response` body (10–2000 characters) plus Idempotency-Key. Staff must have both `support.read` and `support.resolve`, verified MFA and an enabled account. No permission is granted automatically.

The service locks the request and permits only open → resolved. Competing resolutions cannot overwrite the winning response. A same-key retry returns the original committed result, but permissions are rechecked before replay. The response, status, staff identity, timestamp, audit and command result commit together; an audit failure leaves the request open. Resolved requests no longer consume an open-request slot.

Responses are deliberately customer-visible copy, not private staff notes. The owner history returns response and resolution time without staff identity. Both apps render the response as plain text in the request card after refresh, with no HTML/link execution or claim that a push notification was delivered. Missing fields from older API responses default to null. Existing records are preserved by nullable columns; coordinated app/API rollout remains required because old clients use strict DTOs.

Tests cover permission and MFA denial, revoked permission on replay, concurrent resolution, audit rollback, released capacity, owner-only visibility and endpoint payload validation. A synthetic resolved response was visually checked at 390×844 in the driver web preview. Actual provider notifications, multi-message conversations, reopening/escalation policy, staff queue pagination and the dashboard are still pending. Resolution does not change driver eligibility, refund a payment or mutate a ride.
