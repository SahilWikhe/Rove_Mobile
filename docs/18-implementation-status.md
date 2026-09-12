# Implementation status

Updated: September 12, 2026. Current source baseline: `908377e4fda2daff20faa235c304683485b78d98` plus the loss-allocation checkpoint below. This records implementation and evidence, not production readiness or a percentage-complete estimate.

## Audited payment loss allocation — September 12

Implemented protected staff review and allocation endpoints, shared signed contracts, migration 0035 and immutable policy attribution. Explicit approved amounts resolve verified refund/dispute suspense into released rider liability, remaining unpaid driver earnings and platform loss expense. The service prevents duplicate decisions, over-deduction, stale-balance acceptance and restoration beyond a party's prior allocation for that category. Original capture/gross earnings journals remain unchanged. Refunded rider funds cannot subsequently become a second full-fare earnings allocation. Audit, journal, decision and idempotent command commit atomically.

All eleven local application test tasks passed, including 455 server tests. Final review-response checks passed nine allocation tests and ten receipt/staff API tests. Coverage includes concurrency, retry, MFA/permission revocation, source isolation, reinstatement, stale facts, audit failure rollback, immutable decisions and the real authenticated HTTP route. Workspace/E2E types, source lint excluding generated reports, boundaries, formatting, documentation checks, packaged API build verification and schema-generation no-diff check passed. Tests use disposable local PostgreSQL and synthetic financial records. Initial generated SQL attempted to recreate already-versioned refund/dispute tables because the saved schema snapshot lagged; migration 0035 contains only new changes and the new snapshot now matches current source.

The user has deferred GitHub billing/CI recovery; local development proceeds with hosted CI still mandatory before release. No hosted migration, flag activation, provider call or production transfer occurred. `PAYMENT_LOSS_ALLOCATION_ENABLED` defaults off and requires both refund accounting and dispute tracking. Commercial policy approval remains an owner/operations decision rather than an assumed split.

Next: driver adjustment/net earnings presentation and durable transfer/settlement, then actual deletion fulfillment, remaining native/UI acceptance and production setup. This checkpoint does not transfer funds, prove bank payout readiness, or establish full Figma/device/provider acceptance. See [payment loss allocation](70-payment-loss-allocation.md).

## Dispute verification, accounting and protected staff review — September 12

Added migration 0034, bounded current-provider dispute listing, five signed dispute event hints, durable revision-fenced observations, recovery sweeps and source-keyed balance journals. Financial records distinguish withdrawal and reinstatement rather than inferring a balance return from won status. Raw customer evidence is excluded. The MFA/permission-protected staff queue supports deadline ordering, status filtering and pagination; an authorized refresh endpoint retrieves current facts without provider mutations.

When enabled, unknown/stale/open/lost/unresolved dispute records block staff refund authorization and each mutation attempt. The worker rechecks disputes after authorization, while metadata-based read-only recovery can still bind a refund already created. The separate rollout flag defaults off until migration/provider/operational acceptance. Driver earnings and original capture remain unchanged; commercial suspense allocation and settlement still require completion.

All eleven application test tasks passed, including 446 server tests. Focused provider/domain runs passed forty tests; focused API/runtime/scheduling runs passed forty tests. The signed HTTP test traverses the inbox/outbox worker, verified balance journal and protected staff queue, and proves a false won status in an event cannot override provider data. Workspace/E2E types, source lint excluding generated reports, import boundaries, formatting, documentation lint and packaged API build/health/authentication checks passed. These are synthetic local tests with disposable PostgreSQL and mocked provider transport; no hosted migration, money movement, credentials, permissions or flags changed.

Next: authorized allocation of refund/dispute suspense and driver transfer/settlement, followed by deletion fulfillment and production/device acceptance. Evidence response ownership and provider-controlled submission/acceptance remain operational requirements; automated evidence submission and accepting disputes are not implemented. See [dispute setup and limits](69-disputes.md). No full-app or production completion is claimed.

## Refund correlation recovery and processor balance journals — September 12

Added immutable operation UUID metadata to refund creation and validated correlation to provider history. The worker and MFA/permission-protected staff recovery endpoint can bind a known refund after a lost response without another mutation, including beyond the retry cutoff. Recovery rejects amount-only guesses, duplicate correlation, mismatched amounts and implausible creation times. Manual recovery records its initiating staff actor; unknown outcomes retain their reservation rather than authorizing blind reissue.

Migration 0033 adds refund suspense and processor fee accounts. The optional accounting path expands and validates actual refund/failure balance transactions, journals net impact/fees with stable provider keys and commits those entries atomically with observations. Pending refunds can have real processor balance movement; failure status alone never invents a reversal. Original capture, driver payable and revenue allocations remain unchanged. Commercial loss allocation and suspense resolution remain required before affected settlements.

All eleven application test tasks passed at the integrated checkpoint (including 434 server tests). Subsequent focused recovery verification passed thirteen tests for the final timestamp/actor checks. Workspace/E2E types, source lint excluding generated reports, import boundaries, formatting, documentation lint and packaged API build/health/authentication checks passed. These use disposable PostgreSQL and synthetic/mocked provider records; no hosted migration, monetary request, provider setting or rollout flag changed. No new native UI behavior was introduced or physical/provider acceptance claimed.

Next major financial work: dispute processing, approved refund-suspense allocation/review and driver transfer/settlement workflows, then deletion fulfillment and release/device acceptance. Uncorrelated legacy outcomes still need controlled provider-support review. See [refund balance accounting and recovery](68-refund-accounting.md) for setup steps and limits. The full product goal remains incomplete.

## Staff-authorized refund execution — September 12

Added migration 0032, shared authorization/operation contracts, MFA-protected staff API routes, explicit database permission, durable reservations and `refund.execute` worker handling. The authorization/audit/command/outbox commit is atomic. Verified capture and fresh refund history bound the amount; concurrent or uncertain operations block a second refund decision. Stable provider keys recover lost responses and database failures after provider success. Unknown outcomes older than 23 hours enter review without a new mutation. Receipt success remains based on separate provider reconciliation, not the creation response.

The separate `PAYMENT_REFUND_OPERATIONS_ENABLED` flag defaults off and requires refund tracking. All eleven application test tasks passed, including nine new refund-operation database tests. The final focused API/runtime run passed 24 tests, including permission denial, disabled capability, durable replay and real runtime composition with no startup provider calls. Workspace/E2E types, source lint excluding generated reports, boundaries, formatting, documentation checks and packaged API build verification passed. Tests use disposable PostgreSQL and mocked Stripe; no hosted migrations, real refunds, permissions or provider settings changed.

Remaining before production mutation enablement: controlled ambiguous-outcome resolution, balanced refund accounting, operational review, provider sandbox acceptance and approved commercial policies. Next implementation priority remains financial completion: resolve uncertain operations and implement accounting/disputes/driver settlement, then deletion fulfillment and release/device acceptance. See [staff refund operations](67-refund-operations.md). No full-app or production completion is claimed.

## Durable refund tracking — September 12

Launch gaps now take precedence over small recovery/UI refinements. Added migration 0031, immutable refund observations, revision-fenced reconciliation, signed webhook hints, bounded fair recovery and owned rider receipt states. The rollout flag defaults off until schema and compatible clients are deployed. No refund creation, capture reversal, driver earnings adjustment, dispute handling or transfer is claimed.

Local verification: all eleven application test tasks passed at the main implementation checkpoint; subsequent targeted checks passed seven refund-reconciliation database tests and nineteen webhook/scheduling tests covering final refinements, including fair progress beyond 100 unprocessed payments. Workspace/E2E types passed. Two rider browser tests passed at 320/390 pixels for unchecked history, all refund statuses and support navigation; the 390-pixel screenshot was inspected. Both app exports for iOS/Android/web and packaged API build verification passed at the implementation checkpoint. These are disposable database, synthetic browser and mocked-provider checks, not hosted or physical acceptance. Final source lint (excluding generated local reports), formatting, boundaries, documentation checks, workspace/E2E types and packaged API build verification passed. The unfiltered lint command initially scanned a generated report bundle and failed on that output; application source lint is clean. No cloud migration, refund or provider configuration change occurred.

Next: durable refund authorization/accounting, disputes and driver settlement, then deletion fulfillment and production/device acceptance. Physical tests, production policy/setup and GitHub billing/CI prerequisites remain outstanding. See [refund tracking and rollout](66-refund-tracking.md).

## Refund-history provider boundary — September 12

Added a read-only refund-history capability to the Stripe adapter as the basis for durable reconciliation. It verifies the persisted payment reference before fetching all bounded refund pages, preserves status distinctions and rejects incomplete/duplicate/mismatched/overcommitted histories. Errors exclude raw provider details. No refund creation, receipt change, driver allocation or commercial policy was introduced.

All fifteen Stripe adapter tests passed, including four new history cases. Workspace/E2E types, changed-source lint, package boundaries and the packaged API health/authentication/missing-route checks passed. These use mocked Stripe transport and do not establish sandbox or production refund acceptance. No provider call, cloud configuration or migration occurred. Next: persist observations with retry/version fencing, handle webhook/recovery updates and expose verified refund states on rider receipts; authorization and ledger operations remain separate work. Hosted CI and physical/provider prerequisites remain as documented below.

## Lost notification-proof recovery — September 12

Both apps now offer an explicit, confirmed reset when installation proof is lost, with direct access to account-owned device management. Reset requires a fresh authenticated empty device list after deliberate revocation of the account’s listed devices. It creates a new local proof with notifications off; enabling later uses normal server registration. Healthy pending operations and surviving proofs are preserved. Account changes, failed authorization, invalid responses and failed writes cannot authorize replacement. Server token/revision constraints continue to reject concurrent or cross-account conflicts.

All 168 mobile-core tests and ten PostgreSQL installation tests passed. Six new journal cases and one new database case exercise cleanup, authorization, retry, stale work and token ownership. Workspace/E2E types, changed-source lint, boundaries and both apps’ iOS/Android/web exports passed before the final explanation-only copy edit. The actual shared controls passed an isolated 320/390 browser harness for confirmation, cancel, management, blocked reset and successful retry; Manrope screenshots were inspected. This does not establish physical SecureStore loss or native push acceptance. No personal local storage, account registrations, cloud credentials or provider settings were changed by verification.

Cross-account support cleanup, retention operations, real APNs/FCM delivery and the other production requirements remain unfinished. Hosted CI retains the documented billing/CodeQL prerequisites. Next: native/provider acceptance and remaining financial/release work; paid setup and policy decisions remain in the handoff.

## Native account-deletion access recovery — September 12

Both apps now wait for account restoration before rendering the deletion page. Signed-out or incomplete accounts receive an explicit Continue to your account action leading to the existing welcome/setup flow, rather than an instruction with no action. The authenticated request form remains keyed to the account and unchanged.

All four focused browser scenarios passed, including existing confirmation/idempotency/acknowledgement behavior and both signed-out deep links with zero private support requests. Workspace/E2E typechecks, changed-source lint, import boundaries and both apps’ iOS/Android/web exports passed. The reusable Maestro recovery flow passed for rider and driver on iOS 26.5 and Android API 36; screenshots were inspected for readable wrapping and accessible controls. The first Android driver attempt lost its emulator connection; retry after reconnection passed. No account was signed in, cleared or deleted by these native checks.

Native evidence uses the existing debug binaries and current Metro JavaScript, not fresh Release builds or physical devices. The preceding full browser baseline passed 49/49; this change adds two scenarios and has focused verification, not a new full-suite result. Hosted CI billing and CodeQL prerequisites remain unresolved. No provider configuration, migration or production activation occurred. Next: remaining physical-device/provider acceptance and release requirements below, including actual deletion fulfillment after identity/retention policy approval.

## Full local regression and driver test-state correction — September 12

All 11 application test tasks passed at `319c5d9` (five reused valid Turbo cache entries). The initial full browser run passed 48/49 scenarios and exposed a test assumption: offer recovery waited for the Open your account header button, which is intentionally absent on the online waiting screen. Updated the offer and trip recovery tests to wait for the Account navigation button available in both online/offline states. Product behavior and mutation/recovery assertions were not weakened.

The complete corrected browser suite passed **49/49 in 5.3 minutes**, including the real three-minute no-driver timeout, full two-app trip, moving location, lost booking/acceptance/send responses, messaging, notification-device ownership, deletion acknowledgement, document/eligibility recovery, saved places and trip access. Repository-wide formatting/lint, import boundaries, documentation checks and the packaged API health/authentication/missing-route checks passed. Changed E2E files passed types and lint. This is synthetic local evidence; it does not verify physical native devices, paid-provider behavior or hosted deployment.

GitHub CI run `34710507399` for exact source `319c5d9` was checked and still could not start jobs because of the account billing/spending-limit prerequisite. Resolve GitHub Billing & plans, retain the separate CodeQL setup requirement, and rerun hosted checks before a release candidate is accepted. No production configuration, provider request or migration occurred. Next: continue native/provider acceptance and remaining release features; full production completion is not claimed.

## Deletion-request acknowledgement — September 12

Both account-deletion screens now acknowledge a successful or existing open deletion request with its reference instead of showing another send action. Existing request history and support responses remain accessible. Resolved history permits a new explicit request after reopening. The screen continues to state that the account remains active and submission does not cancel trips, change payments or fulfill deletion. No retention policy or erasure backend was introduced.

Both app browser tests passed for explicit confirmation, a lost response retried with the original idempotency key, a single persisted open request, reopening without another POST, and resolved-history display with a new request available. Rider and driver screenshots were inspected at 390×844. Workspace/E2E typechecks, changed-source lint, boundaries and both apps’ iOS/Android/web exports passed. These are browser and export checks, not physical-device acceptance or completed account erasure. Next: remaining device/UI acceptance and actual deletion fulfillment after the documented identity/retention policies are approved; hosted CI setup remains outstanding.

## Android Firebase release validation — September 12

The EAS pre-install checker now validates supplied Android Firebase files before a native build: readable bounded regular file, client rather than service-account data, and the matching rider/driver package. Production Android requires this file and an exact project match to the explicit `ANDROID_FIREBASE_PROJECT_ID` approval in `config/mobile-production.json`. These approvals remain empty until production infrastructure is selected. Staging can still omit Firebase while push is deferred, and iOS does not require Android configuration. Errors name settings only, never file content or paths.

Eight focused build-check tests passed, including both apps/platforms, production environment separation, absent/wrong-package/wrong-project Firebase configuration, private-key rejection, malformed/oversized files and iOS independence. All 58 tooling tests, changed-script lint, documentation lint across 74 files and diff whitespace checks passed. This validates the release guard, not Firebase credential authorization or a native signed build. Setup and push guides explain the new approval and file requirements. No cloud resources, credentials or payments were changed. Next: remaining device acceptance and release infrastructure, with owner/provider setup deferred as documented below.

## Android push build setup — September 12

Closed a native configuration gap: both apps now consume the Firebase client file through build-time `GOOGLE_SERVICES_JSON`, intended as an EAS secret file variable. Package identity and existing Android settings are preserved; an omitted file does not enable Firebase or block synthetic builds. The notifications plugin sets Android's default channel to the existing registration channel `default`, and server sends explicitly select it. Common local Firebase client files are ignored by Git. FCM service-account private keys remain separate EAS credentials and are never bundled.

Both real Expo introspection checks passed for Firebase path, package/project identity, retained secure-store plugin and generated Android manifest channel. All 57 tooling tests and seven Expo provider tests passed, along with workspace/E2E typechecks, changed-source lint, documentation formatting and whitespace checks. The push guide, mobile build guide, production setup and env examples now explain Firebase client versus FCM service-account files, APNs credentials, rebuilds and physical acceptance. No provider sends, credentials uploads, native binary rebuild or production activation occurred. Config introspection does not prove Firebase initialization or device delivery.

Remote main was confirmed at `0644496` before this checkpoint. Hosted CI billing and CodeQL setup remain prerequisites. Next: configure the documented isolated push credentials when the owner is ready, then verify actual registration/display/taps; meanwhile continue the remaining app and release work below.

## Active-trip storage recovery — September 12

Rider and driver trip screens now share a recovery card with read-only Retry reading request and contextual Contact support. Authorized trip reads continue; cancellation and milestone controls remain unavailable while the operation journal cannot be read. Retry clears stale local confirmation and never submits or discards a saved action. A restored pending action still requires explicit confirmation. Rider recovery also rejects calls while busy, restoring or in a storage error.

All four focused browser cases passed: empty and pending journal recovery for each app, repeated failure, preserved trip details, and zero mutation on retry or first-stage confirmation. Both 390×844 screenshots were inspected. The full synthetic booking-to-completion test passed, including lost acceptance response/recovery, driver location, settlement, receipt and support paths. Workspace/E2E types, changed-source lint, boundaries, both apps’ iOS/Android/web exports and documentation checks passed. The React review preserved keyed account/trip isolation and kept the shared UI free of backend imports. Physical SecureStore failure, native layout and broader device acceptance remain unproven by these browser checks.

The preceding driver offer fix was confirmed on remote main at `3ddb43a`. Hosted CI billing and CodeQL prerequisites remain unresolved; no provider, infrastructure or production settings changed here. Next: continue the remaining native/UI acceptance and production release requirements below.

## Driver offer storage recovery — September 12

Driver offer storage failures now provide Retry reading request, Contact support and Back to driving using existing shared controls. Retry only reloads the journal. Accept/decline stay unavailable while it cannot be read, and a recovered saved acceptance still requires explicit Check acceptance result. No operation is discarded or automatically replayed.

Three focused browser cases passed: repeated failure and empty-journal recovery, saved-acceptance recovery with no mutation, and existing offer layout/expiry behavior. The recovery screenshot was inspected at 390×844. Workspace/E2E typechecks, changed-source lint, package boundaries and driver iOS/Android/web exports passed. These do not establish native SecureStore failure acceptance or full Figma parity. Next: remaining trip recovery and cross-platform UI/device acceptance.

Remote main was verified at `ad16b3c`. Its CI run `34708488268` completed without starting any jobs: GitHub's annotation reports failed account payments or a spending limit requiring attention in Billing & plans. Resolve that account prerequisite and rerun exact-source checks; local passes do not replace hosted CI. Earlier run `34707309751` ultimately cancelled, superseding its partial in-progress observation below. CodeQL entitlement remains a separate prerequisite. No cloud configuration or paid provider requests were changed in this checkpoint.

## Rider booking storage recovery — September 12

Reviewed the actual rider Figma `4:20` design context and existing route-entry components. The normal header/route/place-result hierarchy already follows that frame with approved consumer and scheduling deviations. Fixed a recovery gap: unreadable saved-operation storage previously left booking on an error-only screen. It now offers read-only retry, support and home navigation using the shared gold/secondary controls. A still-unreadable journal blocks new booking; a recovered saved operation requires explicit confirmation and is never submitted by retry.

Both targeted synthetic browser cases passed: recovery to an empty booking form and recovery to an existing operation without a booking POST. Repeated read failure remained blocked. The final 390×844 recovery screenshot was inspected. Workspace/E2E typechecks, changed-source lint and import boundaries passed. Both apps’ iOS/Android/web exports and documentation checks passed. This is browser evidence, not physical keychain failure acceptance or complete Figma parity. No provider calls or production setup changed. Next: remaining rider UI/device acceptance and the release requirements below.

## Documentation reconciliation and Android launch smoke — September 12

Reconciled the testing strategy, workflow inventory, native verification guides and design contract with current source. The location guide now describes requested three-second GPS samples and WebSocket-triggered authorized reads, with five-second polling only as fallback. CI documentation includes standalone welcome/relaunch checks and the manual read-only release-readiness workflow. Historical checkpoints below remain dated evidence; their pending items are superseded only where a later checkpoint records implementation or acceptance.

Added the Android counterpart to the iOS release smoke: package identity validation, a dedicated temporary API 36 emulator, two standalone welcome launches, JUnit/log retention and cleanup without touching the preview emulator. Both freshly built ARM64 Release APKs passed welcome and relaunch locally on fresh API 36 emulators. Two preceding driver attempts lost the ADB device before launch; the diagnostic run passed. This is an intermittent emulator failure, not a demonstrated app fix. Maestro diagnostics and filtered runtime logs are retained for future CI failures. Hosted Android/iOS smoke acceptance remains outstanding. Documentation lint across 74 files, all 349 local file links, changed-script lint/formatting, workflow YAML parsing and diff whitespace checks passed.

CI run `34707309751` for the preceding source passed quality, tests, browser, mobile exports, security and infrastructure at the latest read; native jobs were still running and CodeQL had failed. The code-scanning setup prerequisite remains deferred, with no gate bypass. No provider requests, cloud configuration, migrations or production activation were performed. Next: collect exact-source hosted evidence, investigate any recurring emulator disconnect and complete the remaining device and production requirements below.

## Standalone iOS launch smoke infrastructure — September 12

Added a checksum-pinned Maestro welcome/relaunch test to both iOS CI jobs after Release compilation. The runner creates a dedicated simulator, validates bundle identity and JavaScript presence, installs the app, asserts Get started on two launches, captures JUnit/screenshot evidence and deletes its simulator. It does not use Metro or log into an account. Both existing local rider and driver Release artifacts passed on fresh iOS 26.5 simulators; screenshots were inspected. These cached artifacts validate the runner, not a rebuild of current source. Hosted launch acceptance remains outstanding. Lint, formatting, workflow YAML parsing and documentation checks passed.

Corrected CI run `34706864852` progressed beyond the previous workflow-metadata permission error, then GitHub rejected CodeQL upload because code scanning is not enabled for this private repository. That is now an explicit deferred owner setup item in [production setup](production-setup.md#github-code-scanning-prerequisite); no entitlement purchase, feature activation or gate bypass occurred. Android automated launch, full native journeys and physical-device acceptance remain open. Next: verify the new hosted smoke jobs and continue remaining app/device acceptance while preserving the security prerequisite.

## Full regression checkpoint and CodeQL permission correction — September 12

At source `1544da0`, all 11 local application test tasks passed and all 41 browser scenarios passed in 5.4 minutes, including the real search timeout, complete trip, messaging and recovery cases. Repository-wide formatting passed. Cloud run `34706460649` passed quality, application tests, mobile exports, security and infrastructure; native builds and browser were still running when inspected.

That run failed CodeQL after query evaluation while accessing workflow-run metadata: `Resource not accessible by integration` for Get a workflow run. Added `actions: read` only to the CodeQL job, retaining existing contents-read and security-events-write permissions. This matches the [GitHub endpoint permission](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run). The job still must upload analysis and pass the existing findings gate; neither is bypassed. Workflow parsing and documentation checks passed locally; a successful corrected hosted CodeQL/native run remains outstanding. A new push is required for the permission fix, so the prior run is not a complete green checkpoint. No app behavior, provider requests or production activation changed.

## Manual release-readiness infrastructure — September 12

Added a read-only GitHub workflow around the existing exact-commit release-evidence checker. It validates main-branch ancestry and checkout identity, checks CI/provider run provenance and current attempts, and retains a timestamped report identifying the verifier source. It needs no production secrets and performs no deployment, migration or billable provider requests. See [production setup](production-setup.md#manual-github-release-readiness-report).

All 55 tooling tests passed, including nine focused candidate/evidence tests with a real temporary Git repository, unmerged candidates and mocked GitHub pagination/rerun failures. Lint, documentation and workflow YAML parsing passed. A local collection against real successful runs for `1ce0170` correctly rejected them: that historical CI run has no native Android/iOS jobs required by the current gate. No success artifact or production approval was produced. Hosted workflow execution and a live positive result are not yet accepted. Production promotion, device acceptance and final service/policy setup remain open; this report is evidence collection, not launch approval. Next: validate the workflow in GitHub and continue the remaining acceptance/setup work below.

## Messaging entry recovery and compact composition — September 12

Both apps now wait for account restoration on message routes, provide account recovery for signed-out inbox/thread links, and offer Messages for malformed conversation IDs before mounting private thread loaders. Existing account/conversation state isolation is preserved. Both composers were also checked with long drafts at 320×360; Input and Send stayed within the viewport with minimum 48-point heights.

Verification: all three targeted browser tests passed (rider recovery, driver recovery and the complete persisted/realtime exchange with compact composition/report controls). Workspace/E2E types, lint, boundaries and both apps’ iOS/Android/web exports passed. The installed Android rider preview displayed the inbox recovery action. React review checked conditional mounting, hook placement and existing account keys. Initial malformed-link browser checks reset the memory-only synthetic session; they do not establish signed-in malformed-link acceptance. That native check, actual keyboard interaction and VoiceOver/TalkBack remain open. No cloud setup or real provider calls occurred. Next: remaining device/UI acceptance and deferred release work below.

## Messaging accessibility — September 12

Shared rider/driver message bubbles now identify the sender and localized date/time through accessible labels. Inbox controls expose previews/unread status; quick replies explain draft behavior; send and report controls expose their current state. The complete synthetic messaging browser journey passed, including bidirectional persisted exchange, lost-send retry, WebSocket invalidation, compact report controls and the new accessibility assertions. Workspace/E2E typechecks, lint, boundaries, both apps’ iOS/Android/web exports and documentation lint also passed. The initial test caught an unsupported web state mapping; cross-platform ARIA props fixed it while retaining native React Native mapping.

This is implemented source and browser evidence, not completed VoiceOver/TalkBack device acceptance. No hosted provider calls or production activation occurred. Next: remaining native screen-reader, keyboard and full-device acceptance, with owner/provider setup deferred as listed below.

## Android font-scale route retention — September 12

Both Expo app configs now preserve their mounted Android activity when system text size changes. The app-local manifest plugins append `fontScale` without replacing existing activity flags; React Native handles text relayout. This fixes the earlier return to an old launch link when changing accessibility text size. A rebuilt native app is required.

Verification: sequential rider and driver Android arm64 debug builds passed and were installed on the API 36 emulator. After opening an initial trip link, rider About and driver Coverage remained selected at 200% text size, with body text visibly growing. Both retained their screens and shrank text again after backgrounding, restoring 100% and resuming the existing task. The original font setting is restored. Four new manifest regression checks passed within all 53 tooling tests; workspace/E2E types, lint and import boundaries passed. The first concurrent builds raced in shared native outputs; sequential builds resolved the missing driver module and rider codegen failure. See [mobile build procedure](mobile-staging-builds.md#android-text-size-changes).

This is local emulator verification, not physical-device or full accessibility acceptance. No cloud credentials, provider calls or production activation changed. Next: remaining screen/device acceptance and the release/setup items below.

## Driver trip-link recovery — September 12

Applied account-restoration, signed-out recovery and UUID validation to driver trip links. Private trip loaders and pending-operation controls are not mounted before an account is ready. Initial read failures offer a route to Trips rather than an indefinite loading claim; existing account/ride state isolation remains intact.

Verification: the completed synthetic rider/driver journey and both signed-out link recovery checks passed (three browser tests). All workspace/E2E types, lint, import boundaries and driver iOS/Android/web exports passed. iOS Maestro launch/link/scroll/action-visibility checks passed at the largest accessibility text size, with the original setting restored. Native Android cold-link recovery also displayed correctly. During font-size changes Android recreated the activity and returned to an earlier launch route; ordinary warm navigation worked when tested separately. That configuration-change issue is addressed by the later Android font-scale checkpoint above. Remaining screen/device acceptance is still open. No cloud setup or production activation occurred.

## Rider ride-link recovery and compact-screen verification — September 12

Native inspection found a signed-out rider stranded on Please sign in plus Loading your ride, with no recovery action. The route now waits for account restoration, offers account recovery before making private reads, rejects incomplete ride links and isolates trip state by account/ride. An initial read failure offers My rides rather than an indefinite loading claim.

The corrected recovery screen was visually verified on the Android emulator at 200% system text size; its text and action remained fully visible and the original font setting was restored. On iOS, a Maestro check at accessibility-extra-extra-extra-large passed app launch, ride-link opening, scrolling to the recovery action and its visibility assertion; the simulator’s original large setting was restored. The debug warning overlay remains outside this product-layout acceptance. Compact browser checks verify 320×568 navigation label fit, minimum touch areas, viewport bounds, full end-of-scroll Home-card clearance and account/history recovery. This does not establish complete Figma parity or full native accessibility acceptance. All six targeted browser regressions passed, including booking/cancellation, completed trip, lost-response recovery and real search expiration/retry. Workspace/E2E types, lint, import boundaries, rider iOS/Android/web exports and documentation lint passed. Next: continue remaining rider/driver screen and device acceptance; production setup and provider decisions remain deferred below.

## In-app verification-email resend — September 12

Implemented the server Auth0 verification-job adapter, optional server configuration, authenticated recovery endpoint and shared rider/driver resend UI. Only the signed-in subject can be targeted. Shared database limits bound both per-account and total attempts; normal verified-email API protection remains unchanged. The UI handles acceptance and cooldown without treating a request as delivery or marking the account verified.

Verification: 145 API tests passed, including eight new provider/security cases; both browser recovery journeys passed. All workspace/E2E types, lint, boundaries and both apps' iOS/Android/web exports passed. No real emails were sent or cloud configuration changed. The dedicated server credential, hosted resend delivery and native recovery acceptance are deferred setup; see [authentication recovery](46-auth-refresh-recovery.md#deferred-server-setup). Next: hosted account-recovery acceptance when configured, plus the remaining UI and physical-device checks below. This is not a production-ready release.

## Documentation follow-up — September 12

The comprehensive refresh in `40c82cd` updated the architecture, feature guides, staging and production runbooks, and documentation index. This follow-up advances the source reference to the subsequent driver trip-support change, which is documented below and in the support/design guides. Historical test counts and deployment observations remain dated evidence.

At this review, [CI run 34703505858](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34703505858) for `24c74f6` was still in progress. The earlier successful CI run below must not be presented as a pass for this source. No new application changes, provider calls, migrations or deployment verification were performed in this documentation follow-up. Documentation lint and local Markdown link checks passed.

Email verification enforcement and in-app resend remain unfinished release work; investigation is not implementation. Next: complete the remaining account recovery work and UI/device acceptance, then record the actual results here. Production setup and owner decisions remain deferred and explicitly listed below.

## Driver trip support — September 12

Driver trip details now offer Get help with this trip during active or ended work. Both apps share the same support-context component: it reads the requested trip through the signed-in account's API, attaches only a matching verified reference, requires a user-written description and offers general support when verification fails. Account/route-keyed mounts and aborted obsolete reads prevent a late result from changing another account's form. This does not submit automatically, alter a ride or move money.

Verification: the full synthetic browser booking/completion journey passed in 50.4 seconds, including a driver request persisted with the exact trip reference/category and the existing rider support, denied-read recovery, receipt and rebooking assertions. All eight workspace typechecks plus E2E types, lint, import boundaries and both apps' iOS/Android/web exports passed. No new native dependency was added. Physical-device acceptance and the remaining release work below are unchanged.

The preceding documentation commit `40c82cdc3d9ae55be152bce2477a65996c3e4e39` passed every required CI job, including all four native debug/release builds, in [run 34682282758](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34682282758). That CI result predates this support change; it is not evidence that this new commit's CI has already passed.

## Current checkpoint

Both mobile apps and the shared backend support the core synthetic ride journey. Hosted provider staging exists. The product is not ready for public launch; a local test, native compile, hosted provider check and physical-device journey establish different things.

| Area | Implemented now | Evidence and remaining boundary |
| --- | --- | --- |
| Rider UI | Figma-derived Home, route/quote review, matching animation, trip/history, completion, receipts, contextual support, saved places, payment settings and floating navigation | Completion/support journey passed locally; completion inspected on iOS and Android. Full Figma, accessibility and large-text acceptance remains open. |
| Driver UI | Floating translucent navigation/cards, draggable map sheet, offers/trips, earnings/date filters, profile, vehicle/documents, payout setup, messaging and coverage settings | Native previews and synthetic journeys exercised; this is not a complete physical-device acceptance pass. |
| Authentication | Auth0 PKCE, refresh/revocation, scoped SecureStore, callback routing, stale-response guards and verified-email recovery UI | Staging protocol and iOS/Android simulator login/session paths have evidence. Email claim Action and one manual verified-email delivery were checked; in-app resend now has local implementation/tests; hosted resend setup, runtime enforcement and native acceptance remain release work. |
| Messaging | Assignment-scoped inbox/thread, reports, unread state, durable idempotent sends and authenticated WebSockets | Dedicated Auth0 staging accounts exchanged messages with retry/read/reconnect checks. Push and permanent deletion are separate unfinished work. |
| Driver location | Native location-only grants, requested three-second delivery and rider WebSocket invalidations with authorized HTTPS reads | Local cross-instance and moving-location tests passed. Five-second rider polling is fallback only. Locked-phone, battery, permission and network behavior still needs physical devices. |
| Matching | Eligible online drivers, timed offers, concurrency protection, configurable 1–100 mile radius (default 25), plus route-time limit | Radius/retry/race tests passed; field dispatch latency and operating policies remain launch checks. |
| Maps/navigation | Native Google maps and in-app Navigation SDK, pickup/destination guidance and compact controls | Simulator guidance has been displayed. Physical spoken/reroute/background acceptance and optional published cloud style are not established. |
| Payments | Stripe sandbox adapter, PaymentSheet/CustomerSheet, durable sessions, webhooks, capture/allocation ledger, receipts and earnings | iOS sandbox CustomerSheet save/reopen/remove passed. Full native PaymentSheet/3DS, refunds/disputes, driver transfers and settlement are not complete. |
| Documents/support | Private document intake/upload/scanning/review code, staff authorization, support intake/resolution, account-deletion request intake | Intake is not completed deletion fulfillment, staffed support or proof of every hosted document/provider path. |
| Notifications | Registration/revocation, owned device list, tap authorization, durable delivery/receipt worker and repair when installation proof survives | Real APNs/FCM/Expo delivery remains disabled pending setup and physical-device checks. Lost proof has explicit reset after owned-device cleanup; cross-account support remains separate. |

## Hosted staging and deployment

- Neon remains the database. Provider staging is `rove-provider-staging` (`br-super-leaf-axpo6edu`) in project `square-frost-35273983`, with 31 migration entries through `0030_driver_location_notifications` applied and the location notification trigger checked. The restricted application role serves runtime traffic; direct realtime and pooled query connections use the same role/database. The older synthetic branch is separate; see [Neon staging](60-neon-staging.md).
- [Staging API](https://rove-api-staging.vercel.app) is Git-connected to `main`. On September 12, Vercel reported deployment `dpl_38Me36WZxPomkGGw4Bv7tjp7XwEZ` READY at source `31f7e42199448b4686be82a3e9738947752b324d`, region `iad1`. Vercel's **Production target in this staging project is still application staging**. This is not a real production launch.
- Local previews can still use disposable PostgreSQL and simulated providers. `pnpm dev:staging:rider` / `pnpm dev:staging:driver` select the hosted staging API and Auth0; neither command builds native binaries. See [mobile builds](mobile-staging-builds.md).
- Main pushes may deploy staging independently of CI. A controlled production promotion workflow is not configured. Production resources, credentials, migrations and app-store distribution remain separate work.

## Recent completed work and verification

Recent source commits include real-time rider location (`dda0cb8`), three-second native GPS scheduling (`694f326`), notification storage repair (`bf0911c`) and rider completion/contextual support (`31f7e42`). Earlier work added coverage radius (`f63338e`), driver-following camera, matching animation, floating rider navigation and subtle gold gradients. These are completed changes, not items to repeat in the next backlog.

For `31f7e42`, the targeted browser booking-to-completion journey passed, including moving driver location, receipt read failure/recovery, contextual support submission, denied ride access and rebooking. Rider completion screenshots were inspected on iOS and Android. Workspace/E2E typechecks, lint and both apps' iOS/Android/web exports passed. Exports do not prove native runtime behavior.

[CI run 34681478308](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34681478308) is the exact-source CI reference. At the September 12 audit read, tests, browser, quality, mobile, infrastructure, security and CodeQL had passed; the four native matrix jobs were still running. Do not infer a full green gate from these partial results. Inspect the run and use `pnpm release:check` for a release candidate; evidence for one SHA does not certify a later SHA.

This documentation refresh reconciles the current guides, infrastructure handoff, architecture decisions and historical checkpoints against that baseline. Documentation validation passed: Markdown lint across 74 root/guide files, local file/heading links across 82 Markdown files (340 links), and diff whitespace checks. The refresh does not rerun paid provider checks or claim a new product acceptance pass.

## Remaining work

1. Finish rider/driver Figma and cross-platform acceptance, including smaller screens, dynamic type, screen readers, keyboard and failure states.
2. Run full physical iOS/Android journeys: Auth0, PaymentSheet/3DS/recovery, navigation, GPS with screen locked, permission changes, reconnect/relaunch and battery behavior.
3. Configure isolated Expo/APNs/FCM and signing, then verify notification registration, delivery, receipts, taps and cold starts. Verify lost-installation-proof reset physically and complete cross-account support/retention operations.
4. Finish refund/dispute controls and journals, actual driver transfers/payout settlement, reconciliation/review operations and approved financial policies. Recorded earnings are not withdrawable funds.
5. Fulfill account deletion with identity/storage/retention handling; approve and implement permanent message deletion. The 30-day message visibility window is not deletion.
6. Provision isolated production services; rehearse controlled migrations/promotion, monitoring, restore, load and operational support. Prepare store distribution and review.
7. Resolve deferred owner decisions: launch area/hours, fares/fees, driver compensation, cancellation/refund rules, retention and support coverage. Scheduling remains off; B2B is optional.

Next engineering step after this documentation update: resume the outstanding UI/device acceptance and resolve concrete failures, keeping release setup and owner decisions explicit. No overall completion percentage is asserted without a fixed, accepted scope and acceptance checklist.

## Historical implementation ledger

The entries below preserve their original checkpoint context. Their test totals, deployment observations, “remaining” lists and “next” actions were true or proposed **at that checkpoint**, not current status. Use the sections above and current feature guides for today's behavior. Historical screenshots likewise show the build they captured.

### Android native Auth0 callback and session acceptance — September 10

Android hosted login exposed an actual callback-routing defect: Expo Router treated the OAuth response as a page and displayed Unmatched Route. Added per-app `+native-intent` hooks and a shared, narrowly scoped callback rewrite. Only the app's exact callback is mapped to `/`; query/fragment contents never enter router state. AuthSession still owns the original response, PKCE/state validation and token exchange. Unrelated, other-scheme and malformed links retain their original routing behavior. This follows Expo's [native intent guidance](https://docs.expo.dev/router/advanced/native-intent/).

With the fix loaded, separate synthetic Android rider and driver identities completed hosted login, native callback, profile creation, Home display, full app stop/relaunch with restored session, sign-out and another relaunch remaining signed out. The unapproved driver's review message and disabled Go online control were asserted. The rider's first registration retry encountered removed emulator port forwarding between test runs; restoring mappings resolved the local transport issue and the complete sequence passed. No eligibility override or real ride/payment was enabled.

Verification: all 99 mobile-core tests passed, including nine callback-routing regression cases; mobile-core/rider/driver typechecks, changed-source lint and boundaries passed. Documentation lint, formatting and whitespace checks passed. Both temporary Android identities were blocked with independent readback, and their credential-bearing automation artifacts were removed; the founder’s manual rider fixture was preserved. No new native dependency was introduced by this callback fix. The earlier iOS acceptance predates this hook and the system-ui module; rebuild and rerun iOS before claiming cross-platform completion. Next: that iOS rebuild/retest, the local shutdown limitation, then remaining Maps/Stripe staging prerequisites. No deployment occurred; the product remains incomplete.

### Android native build checkpoint — September 10

Installed checksum-verified Android command-line tools and full Temurin JDK 21, required SDK/NDK/compiler packages, and booted a dedicated ARM64 Android 36 Pixel 7 emulator. Added Expo-compatible `expo-system-ui` to both apps because their configured dark interface style required it. Expo prebuild completed for both apps with the missing-module warning resolved. Both Android debug APKs compiled, installed and displayed their welcome screens. The first rider launch could not find Metro; the explicit per-app debug host/ADB mappings resolved that local setup issue. See [Android verification](63-android-native-verification.md).

Verification: both native Gradle builds succeeded; both app typechecks, formatting, boundaries, frozen-lockfile install, documentation lint and whitespace checks passed. Native compiler/deprecation warnings remain in dependencies. Android auth and complete journeys remain unverified, as does an iOS rebuild with the new module. No production configuration, real identities/payments or deployment changed. Next: complete Android native authentication/session acceptance and resolve the earlier local shutdown issue, then finish Maps/Stripe staging prerequisites. The full product remains incomplete.

### Driver native Auth0 acceptance — September 10

Rebuilt the driver iOS Debug app with its separate staging Auth0 client; build succeeded with zero errors and two existing Metal toolchain search-path warnings. A separate synthetic identity completed hosted login, the native callback, profile registration, the driver home screen and full app relaunch with session restoration. Native assertions confirmed the document/payout review message and disabled Go online control for the unapproved account. Account sign-out and another relaunch remained signed out. No approval, real location tracking or real ride was enabled.

The synthetic driver identity was blocked with independent readback after verification and its private credential-bearing temporary files/automation logs removed. The founder's separate manual rider fixture was preserved. No application source changed in this checkpoint. Documentation lint and whitespace checks passed. CI for runtime commit `0ca6bda776cf92a3ca706311a81d34731bbfd5b6` completed successfully, including tests, mobile, browser, quality, security and CodeQL: run `34484174415`.

Next: Android native auth/build acceptance and the local terminal shutdown issue, followed by remaining Maps/Stripe staging prerequisites. Simulator acceptance does not prove physical-device behavior, background GPS, real payments or cloud deployment. The full product remains incomplete.

### Rider native Auth0 acceptance — September 10

The founder completed hosted Auth0 login manually with a synthetic staging account. After restarting the isolated API and the original iPhone 17 Pro simulator, the app restored its saved credentials and reached profile creation without another login. Created the synthetic rider profile through the native UI, reached Home, terminated/relaunched the app and verified Home returned. Account sign-out followed by another relaunch stayed signed out. The separate iPhone 17 simulator did not contain this app/session; use the original simulator for continuity.

Fixed the discovery URL separator while preserving the exact JWT issuer and credential scope. Native profile testing also exposed keyboard obstruction: shared scrolling screens now adjust iOS keyboard insets and dismiss the keyboard on drag. Re-tested registration successfully after a fresh bundle reload. All 90 mobile-core tests, mobile-core/mobile-ui/rider/driver typechecks, changed-source lint, formatting and boundaries passed; documentation and whitespace checks passed before commit. No broad full-suite or Android pass is claimed.

Next: verify driver/Android auth and account switching, diagnose the earlier terminal shutdown exception, then finish Maps/Stripe staging prerequisites. The manual synthetic Auth0 account remains available for the founder's testing; no production identities, Neon data or cloud deployment were changed. The backend remains disposable and maps/payments simulated. The full product remains incomplete.

### Paused native Auth0 verification — September 10

Fixed a native discovery failure caused by Expo appending a slash to the trailing-slash Auth0 issuer. Only the discovery fetch base is normalized; JWT issuer and credential scope remain exact. Rider iOS Debug build succeeded and the hosted Auth0 login form opened. All 90 mobile-core tests, mobile-core/rider/driver typechecks, changed-source lint and boundaries passed. Automated synthetic credential entry has not yet completed native login; callback, profile creation, SecureStore restoration and driver/Android acceptance remain unverified. The synthetic fixture was blocked with readback and private temporary credential files removed. Local test processes were stopped for the requested pause. This terminal interruption still produced a PostgreSQL pool shutdown exception (exit 1), despite the earlier isolated signal tests; terminal shutdown needs further diagnosis. Credential-bearing Maestro run artifacts were also removed. These source changes are not yet committed or pushed. Next: resume a fresh synthetic native login, verify the full session lifecycle, then update the provider handoff and commit/push the verified change. No cloud deployment occurred.

### Local Auth0 shutdown fix — September 10

Replaced the Auth0 harness command with a supervised launcher that isolates its child process group and forwards termination to the API before PostgreSQL. A bounded timeout prevents indefinite shutdown. Real SIGINT and SIGTERM integration checks both exited zero without pool exceptions and removed their disposable database directories. Changed-script lint, documentation lint and whitespace checks passed. Windows behavior and native auth interaction remain unverified; no runtime application behavior or cloud configuration changed. Next: launch isolated mobile sessions and verify native Auth0 callbacks and session lifecycle.

### Local native-auth harness checkpoint — September 9

Added an explicit local Auth0 identity mode on port 4086 with a disposable database, pinned staging verifier and no seeded approved drivers. Existing synthetic preview/E2E defaults are preserved; mixed E2E/auth mode, invalid modes and deployment contexts are rejected. Added simulator configuration instructions without modifying saved mobile environment files.

Verification: 101 API tests passed, including seven identity-mode tests; API typecheck, changed-source lint, boundaries, documentation lint and whitespace checks passed. Started the harness and verified health plus 401 rejection of synthetic rider/driver and malformed tokens. The iOS simulator is available; native app interaction remains pending. Interrupting the smoke process group exposed a PostgreSQL pool shutdown error, so graceful cleanup is not yet verified. Next: fix local shutdown and complete simulator login/refresh/callback acceptance. No cloud data, provider settings or deployment changed.

### Real Auth0 protocol checkpoint — September 9

Both staging clients completed hosted email/password authorization with synthetic credentials and S256 PKCE. Passed their actual tokens through Rove's backend verifier: expected subjects accepted, incorrect issuer/audience rejected, no MFA inferred. Refresh issued rotated tokens and preserved identity; revoked refresh tokens failed with `invalid_grant`. See [provider evidence and limits](62-provider-setup-handoff.md#real-staging-protocol-verification--september-9).

One synthetic Auth0 account was created without verification-email delivery, then blocked and read back after testing. Private temporary credential/token files were removed. No application database mutation, real user change, purchase or deployment occurred. Documentation lint and whitespace checks passed; no runtime source changed or unrelated tests were rerun. This is real provider protocol evidence, not an iOS/Android interaction or full hosted API test. Next: verify native callbacks, secure storage and session lifecycle in app development builds, then finish Maps/Stripe provider setup and staging deployment prerequisites.

### Repeatable Auth0 verification checkpoint — September 9

Added `pnpm auth:staging:check` with explicit staging tenant/resource selection, client-secret-free reads, paginated connection checks, pinned HTTPS discovery/JWKS requests and sanitized diagnostics. Eleven regression tests cover policy drift and run in the existing credential-free CI tooling step. The live command remains an explicit authenticated operator check.

Verification: all 11 new tests, changed-script lint, documentation lint and whitespace checks passed; the live read-only command passed against Auth0 staging. This does not perform user login, token exchange, refresh/revocation or native callback verification. No provider settings or deployment changed. Next: complete real native authentication verification and missing Maps/Stripe staging configuration; the full mobile product remains incomplete.

### Explicit sign-in checkpoint — September 9

Added `prompt=login` to the shared explicit authorization request to avoid automatically reusing the previous Auth0 browser account after local sign-out. Session restoration and refresh remain unchanged; this UX hint is not an MFA or recent-authentication guarantee. Documented browser SSO/sign-out limits in the provider handoff.

Verification: all 87 mobile-core tests, mobile-core/rider/driver typechecks, changed-source lint, import boundaries, both apps' iOS/Android/web exports, documentation lint and whitespace checks passed. Cookie-aware HTTPS authorization requests for both real staging clients reached Auth0's login form with their configured callback/audience and S256 PKCE. No user credentials were submitted; actual native token exchange, refresh/revocation and account switching remain unverified. Next: complete those flows against the isolated provider environment and finish missing Maps/Stripe configuration. No deployment or production changes occurred.

### Auth0 tenant setup checkpoint — September 9

CLI authorization succeeded. Created Rove Staging API and separate public rider/driver Native clients in the authorized development tenant; enabled their shared email/password connection while preserving existing applications and connection clients. Configured RS256, 15-minute access tokens, rotating refresh tokens with finite lifetimes and exact native callbacks. Recorded public identifiers and verification limits in [provider setup](62-provider-setup-handoff.md#auth0-staging-resources--september-9). Updated only OIDC fields in the ignored partial staging environment file.

Verification: independent Management API reads confirmed settings and connection membership; HTTPS discovery and RSA JWKS retrieval passed. Documentation lint and whitespace checks passed. No application code changed, so runtime tests were not rerun. No users, payments, deployment, paid-plan changes or production database changes were made. Next: verify native login/refresh/revocation against the clean provider environment, finish Maps/Stripe configuration and obtain staging deployment approval.

### Auth0 selection checkpoint — September 9

The owner accepted direct Auth0 setup. Updated ADR-005, mobile architecture and the provider handoff to distinguish the selected provider from unverified integration. The newly installed Auth0 2.1.1 plugin is present locally and its CLI setup guidance is available; no Auth0 MCP tools are exposed in this session. The browser dashboard requires login. No tenant, client, API, paid plan or deployment has been created by this checkpoint.

Next: authenticate tenant management, inspect existing staging resources to avoid duplicates, then configure the rider/driver Native clients and shared API. Verify discovery, PKCE, refresh/revocation and native callbacks before hosted rollout. Installed Auth0 CLI 1.34.0 locally; no existing CLI tenant login was configured, so device authorization was started and awaits the owner. Repository changes are documentation only. Documentation lint (65 files) and whitespace checks passed; runtime tests were not rerun.

### September 9 handoff resumption

Revalidated the clean local checkout against remote `main` at `7c70c9b` before editing. Neon CLI confirms both staging branches and production are ready; no database mutations were performed. Vercel project settings remain the September 8 observation, not a fresh hosted verification. Added [provider setup handoff](62-provider-setup-handoff.md), mapping actual API/mobile variable names, native identifiers, PKCE flow and accepted Stripe events to account setup. Auth0 is a candidate only; ADR-005 remains open. No credentials were printed, uploaded or changed, and no provider purchases or deployment were made.

Verification for this documentation checkpoint: cross-checked instructions against mobile layouts/config, session implementation, Google adapter, Stripe adapter and webhook event allowlist; documentation lint and diff whitespace checks passed. No application code changed, so application tests were not rerun. Next: obtain the identity-provider decision and missing sandbox/maps credentials, then validate their integration before requesting deployment approval.

### Stripe sandbox access checkpoint

Sandbox configuration read succeeded on September 9. Confirmed one active default payment-method configuration; no Stripe mutations or provider payments were performed. Creation searches exposed only GET operations, so write access remains unverified despite the generic write tool. Added the backend restricted-key operation inventory and this limitation to [provider setup](62-provider-setup-handoff.md#september-9-stripe-connection-verification). Documentation lint and whitespace checks passed; no runtime code changed or application tests were rerun. Next: resolve runtime sandbox credentials/configuration and the managed-auth choice; keep deployment gated.

### Read-only database readiness checkpoint

Added `pnpm db:staging:check /path/to/ignored-staging.env`. It reads only the explicitly supplied file, requires the confirmed pooled endpoint with `verify-full`, checks the actual client TLS socket and inspects role/table/sequence permissions inside a read-only transaction. It rejects elevated role flags, role memberships, schema creation, table truncation and missing individual DML grants. Errors expose only fixed diagnostic stages, not driver messages or credentials.

Verification: all eight database tests passed, including real disposable PostgreSQL permission regressions. Database typecheck, changed-source lint, import boundaries, documentation lint and whitespace checks passed. The clean `rove-provider-staging` endpoint passed verified client TLS and restricted grants for 26 application tables. No rows, schema, roles or provider settings were changed by the hosted check. This command does not prove migration completeness, row-level authorization, provider integration or deployment readiness. Next: obtain the managed-auth decision and missing Maps/Stripe runtime configuration; staging deployment remains gated on authorization and hosting support.

### CI dependency repair checkpoint

Inspected actual GitHub CI results and found two dependency failures predating the database checker: a vulnerable TOML parser in documentation tooling and stale Expo patch versions. Updated both apps/shared mobile-core to Expo 57.0.21 and the routers to 57.0.20; constrained the linter's parser to patched 1.7.1. See [CI repair](21-ci-verification.md#september-9-dependency-gate-repair). All workspace tests/typechecks, both Expo compatibility checks, both apps' iOS/Android/web exports, audit, peers and formatting passed locally. All ten browser journeys also passed, including completed trips and the real no-driver search deadline. Frozen-lockfile installation and documentation checks passed. This is a dependency repair, not a deployment or new product feature. Auth/provider setup and staging deployment gates remain unchanged.

### Session storage isolation checkpoint

Replaced role-only saved auth keys with deployment/identity-scoped native SecureStore keys. Backend URL, issuer, client ID, audience, rider/driver role and synthetic mode all separate stored credentials. Legacy unscoped sessions are ignored and require fresh sign-in; browser tokens remain memory-only. The implementation does not select or activate Auth0. See [session isolation](62-provider-setup-handoff.md#saved-session-environment-isolation).

Verification: all 85 mobile-core tests passed, including environment read/write/delete isolation and legacy/failure behavior; mobile-core and both app typechecks, changed-source lint and import boundaries passed. Both apps exported successfully for iOS, Android and web; documentation lint and whitespace checks passed. Real OIDC/native keychain verification remains pending provider setup. No database or cloud configuration changed. Next: finish managed auth/Maps/Stripe sandbox configuration before any authorized staging deployment.

### Access-only session expiration checkpoint

Fixed expired sessions without refresh tokens retaining account state after authorization stopped. Missing refresh grants and explicit null renewal now invalidate pending profile work, clear persistence and notify the UI. Temporary provider outages retain retry behavior. All 87 mobile-core tests, mobile-core typecheck and changed-source lint passed; documentation and whitespace checks passed. New regressions cover access-only expiry and null renewal alongside existing concurrent refresh/sign-out tests. Real native/provider verification remains outstanding; next remains provider configuration and authorized staging deployment.

GitHub's dependency-repair run `34444646599` passed quality, tests, mobile, security and CodeQL; its browser job was cancelled after a later push, so it is not a fully green CI baseline. Local browser verification on that dependency checkpoint passed all ten journeys. Subsequent commits require their own completed remote CI evidence.

### Remote verification and Marketplace handoff

[GitHub CI run 34444997448](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34444997448) completed successfully for implementation commit `66f59d9`: quality, tests, browser, mobile, security, CodeQL and the aggregate gate all passed. This supersedes the earlier cancelled dependency-repair run as the verified implementation baseline. It does not establish hosted provider or physical-device readiness.

Documented Auth0's Vercel Native integration and its Next.js-oriented automatic setup versus Rove's required Expo Native clients/Hono API configuration. Official Marketplace/Auth0 documentation was checked; no integration was installed, tenant selected or cloud settings changed. Documentation lint and whitespace checks passed for this documentation-only checkpoint; application tests were not rerun. Next: the owner chooses the auth setup route and supplies missing provider access/configuration before staging deployment is authorized.

### Next steps in order

1. Completed: create and verify the undeployed Vercel staging project with backend monorepo settings. Keep automatic Git deployment disconnected until configuration is complete.
2. Completed: clean `rove-provider-staging` branch, 24 migrations and separate restricted credentials. Preserve it for actual provider testing; do not run the synthetic payment smoke there.
3. Complete managed OIDC, Google Maps and Stripe sandbox configuration, then configure scoped environment variables and webhook destinations. Never use placeholder secrets to claim readiness.
4. When authorized and the required hosting plan is available, deploy staging, verify HTTP/auth/database/queue/recovery/webhook flows, then point test mobile builds at it.
5. Resume mobile implementation and Figma alignment, native iOS/Android journeys, onboarding and remaining payment/operational work. Keep scheduling and unverified optional integrations disabled.

The configured once-per-minute recovery cron requires a hosting plan that supports that schedule. The user intends to upgrade later. Creating a project does not resolve provider configuration or verify a deployment. See [Vercel staging preparation](61-vercel-staging.md).

## Verified foundation

- pnpm workspace with shared contracts, server domain, database and API package boundaries.
- Strict input schemas for quotes, money, coordinates, driver offers and scheduling capabilities.
- Default-off scheduling capability evaluation and legal trip-state policy.
- Drizzle schema and generated versioned PostgreSQL migration.
- Database constraints for active rider/driver assignments and pending offers.
- Transactional booking, driver acceptance and consumer trip transitions.
- Actor-scoped idempotency results committed with ride mutations, audit records and outbox events.
- Real, isolated local PostgreSQL testing; no production database used. Database shutdown now waits for all connection end events, with a regression test for concurrent/idempotent close.
- Hono API with signed OIDC token validation, database-owned roles, disabled-account checks, JSON validation, bounded bodies and non-cacheable responses.
- Profile registration cannot create staff or approve drivers. Quote creation resolves provider places before pricing.
- Role-scoped ride history/details; drivers lose exact endpoints and rider identity after the trip ends.
- Shared typed mobile API client with response validation, bounded requests and explicit mutation keys.
- Expo rider/driver projects, shared Manrope/black/gold UI, PKCE sign-in and native secure token storage.
- Rider route search, quote review, request, status and history screens; initial driver signup/profile screen.
- Driver availability and sequence-checked location heartbeat, expiring offers, accept/decline, explicit trip milestones and trip history.
- Automatic bounded candidate ranking by route ETA, one pending offer per ride/driver, expiry advancement, deadline exhaustion and cancellation-race checks.
- Persistent outbox leases, fenced completion, retry backoff and dead letters.
- Google Places/Routes adapter with bounded requests, provider-response validation, coarse offer areas and mocked transport tests; not yet wired to a live provider.
- Location-only expiring/rotating background credentials, hash-only storage, offline revocation and monotonic upload validation. Native Expo task/permissions, credential storage, reconnect and cleanup are wired; physical-device verification remains outstanding.
- Disposable local integration server with clearly labeled synthetic maps, identities and payments.

Executed checks: contracts 3 tests; database 5 tests; server 96 tests; API 58 tests; mobile client/tracking/polling/recovery/payment/session 49 tests; driver native lifecycle/sign-out 14 tests (225 total). All eight workspace typechecks pass. Both current Expo apps export iOS, Android and web bundles. Local browser verification exercised rider search/quote/request, driver online/offer/acceptance, arrival/start/completion, rider payment-state update, cancellation and expired-offer handling. Exact details disappeared from the driver view after completion. This used synthetic providers and real local PostgreSQL; it is not native-device or real-provider verification.

CI now has committed-source configuration for full-suite quality, tests, mobile exports, dependency/secret scanning, CodeQL and a fail-closed aggregate gate. Seven tooling regression tests supplement the application tests. See [CI verification](21-ci-verification.md) for dependencies, scope and remaining native verification. The initial pipeline passed all six jobs on [GitHub run 34187153892](https://github.com/SahilWikhe/Rove_Mobile/actions/runs/34187153892).

Bookings, rider cancellation and driver trip transitions now preserve operation keys and payloads in account-scoped storage, with explicit recovery prompts. See [operation recovery](25-operation-recovery.md) for supported operations and remaining device/support work.

## Remaining implementation

- Deployable API composition, production provider wiring, perimeter rate limits and expanded authorization coverage. Authenticated API and background-location rate limits now share atomic PostgreSQL counters with concurrency tests; grant rotation cannot reset upload budgets and the native task respects throttle pauses; see docs/23-request-rate-limits.md. Explicit deployment configuration parsing and secret-safe validation are implemented; see docs/22-api-configuration.md.
- Live route/place provider wiring and verification, payment domain/ledger/worker wiring, tokenized payment UI and webhook reconciliation. A typed Stripe candidate adapter and raw webhook verifier are implemented with nine transport/signature tests; see docs/26-payment-provider.md. Durable ingress adds six HTTP/PostgreSQL tests for signed deliveries, deduplication, rollback, event ordering and size limits; see docs/27-payment-webhook-ingress.md. Provider-backed reconciliation and capture/release worker handlers now have PostgreSQL race tests and a completion-to-settlement outbox test; see docs/28-payment-reconciliation.md. Durable intent creation, rider-only sessions and the mobile API method are now implemented with retry/cancellation tests; see docs/29-payment-session-creation.md. Durable customer provisioning now composes with rider payment sessions; see docs/30-payment-customer-provisioning.md. Native PaymentSheet, callback handling and a rider confirmation screen are now wired with controller tests and platform exports; see docs/31-native-rider-payments.md. Captured-fund and earnings-allocation journals now commit atomically with reconciliation and enforce balance/immutability in PostgreSQL; see docs/32-captured-funds-ledger.md. Rider receipts and runtime composition are implemented; actual sandbox/native-device verification, deployed worker scheduling and the remaining financial operations are outstanding.
- Production durable wakeup/queue integration, reconciliation and operational dead-letter replay.
- Driver onboarding, location/availability, profile/account, ride history, support and earnings.
- Driver earnings/account/onboarding, remaining rider account/help/payment screens, native maps and physical-device background location verification.
- Scheduling module behind default-off flags and provider integration.
- Staff backend permissions and audited use cases; dashboard UI remains a separate repository.
- Extend provider integration/API tests and add native end-to-end verification.
- Environment samples, operational setup and paid-provider/business-decision handoff.

Rider capture receipts now use owned ledger records and show actual captured amounts independently from quoted fares; see [rider receipts](33-rider-receipts.md).

## Known intermediate gaps

The local synthetic API entrypoint runs. A separate Hono entrypoint now composes real adapters and passes a packaged Node smoke check; see docs/34-backend-runtime.md. Unpaid-search expiration now has durable deadline jobs and a bounded recovery sweep; see docs/35-search-expiration.md. Private Vercel queue wakeups and an authenticated recovery cron are now configured in code; see docs/36-worker-hosting.md. Cloud deployment/delivery verification and notification/review consumers remain outstanding. The apps are not end-to-end functional with real accounts yet. Rider booking needs payment-method review, native verification of the new booking/cancellation/transition journal, no-driver retry and verified cancel-fee copy. Rider trip, driver trip and driver availability polling now pause on background/blur, cancel stale requests and resume immediately; see docs/24-live-screen-updates.md. Driver foreground tracking is now owned by the app layout and survives route navigation, with cancellation on backgrounding/sign-out and fresh server sequence recovery. Native background tracking now uses a separate location-only grant and module-scope task, with native permission configuration and lifecycle tests. Physical-device background delivery and complete operational recovery remain unverified; see docs/20-driver-location.md. Driver profile creation does not yet lead to the full document/payout onboarding flow. OAuth account selection and real native callbacks still need provider/device verification. Figma design context and screenshots for rider Home (2:12) and driver Online (1:62) were retrieved successfully on September 7. The rider Home and shared colours now have initial Figma alignment and iOS visual verification; remaining frames and Android visual verification are outstanding. See [rider home design](40-rider-home-design.md). Driver Trips and Earnings now have separate navigation. Recorded driver allocations have an owned API and earnings screen; older/newer history browsing is implemented; date filters and payout workflows remain outstanding; see docs/37-driver-earnings.md.

Both apps now support owned profile-name editing with conflict detection and shared mobile UI; see [profile editing](38-profile-editing.md).

The rider native Debug build now compiled successfully with Xcode for the local iPhone 17 Pro simulator (iOS 26.5). The installed `co.roveride.rider` app launched and its synthetic welcome screen was visually inspected. CocoaPods 1.17.0 was installed locally for this build. This proves native compilation/startup only: native sign-in, trip execution, PaymentSheet, physical-device background delivery and Android native builds remain unverified. The simulator and local preview servers were left running for the founder to explore.

Driver Account now supports ordered offline confirmation, tracking cleanup and sign-out with failure recovery; see [driver sign-out](39-driver-sign-out.md). The driver Debug app also compiled and launched in the iOS simulator; its synthetic home screen was inspected. Physical-device and complete native ride/auth/payment verification remain outstanding.

Session generation guards and serialized credential storage now prevent stale refresh/login/hydration results from restoring signed-out credentials; see [session lifecycle](41-session-lifecycle.md). Managed-provider and full native auth verification remain outstanding.

Rider and driver history now support older/newer page navigation with foreground refresh and account-scoped state; see [ride history browsing](42-ride-history.md).

Booking lookups now cancel obsolete search/quote responses, clear edited route selections and isolate account navigation; see [booking request lifecycle](43-booking-request-lifecycle.md).

Rider booking now offers Standard and Accessible service selection with new-quote review and eligibility regression coverage; see [ride service selection](44-ride-service-selection.md).

The quote confirmation now follows the supplied Figma route-card, typography and gold-action design with consumer quote data; see [confirmation design](45-booking-confirmation-design.md).

Temporary auth refresh failures now preserve saved sessions while preventing expired-token API requests; see [auth refresh recovery](46-auth-refresh-recovery.md).

An owned Home/Work saved-place API, migration, mobile client, booking controls and Home shortcuts are implemented; the shortcut flow passes browser and iOS simulator checks. Full native management, Android interaction and hosted-environment migration remain pending. See [saved places](47-saved-places.md).

A driver-owned vehicle-submission API and client now separate pending vehicle details from effective approval; a driver vehicle form and staff review API are implemented, while document upload and full eligibility activation remain pending. See [vehicle submissions](48-driver-vehicle-submission.md).

A permission-scoped staff vehicle review API now records immutable decisions without enabling driver eligibility; see [staff vehicle review](49-staff-vehicle-review.md). Staff review requires verified MFA and explicit permission. Provider MFA setup verification, document upload and the separate dashboard remain pending.

Consumer support intake, history, staff queue/response APIs and safe vehicle correction guidance are implemented; see [support requests](50-support-requests.md). This is not a staffed or emergency support operation.

Required browser CI now covers booking/cancellation, the two-app synthetic trip, receipt/earnings history, lost-response recovery, support and real search-deadline recovery; see [browser checks](51-browser-ci.md). Local payments run through shared reconciliation/ledger services with a synthetic provider; real Stripe settlement remains unverified.

Completed driver trips show ledger-backed earnings with explicit payout limitations; see [trip earnings](52-driver-trip-earnings.md). An unmatched rider search can lead to a fresh route/quote review without automatic booking; see [search recovery](53-no-driver-recovery.md).

Shared native endpoint maps have been added to authorized ride/trip details; see [native maps](54-native-trip-maps.md). Production SDK key setup and real Google rendering remain outstanding. Rider-visible driver location now has assignment authorization, sample-time freshness and foreground polling; see [live driver location](55-live-driver-location.md). Physical-device GPS delivery is still unverified.

Driver payout onboarding now has a durable provider binding, Accounts v2 adapter, authenticated endpoints and a driver setup screen; see [payout onboarding](56-driver-payout-onboarding.md). It defaults off, does not enable driving or transfer money, and still requires real sandbox/native verification. Dedicated account-event reconciliation now updates expiring payout readiness and revokes stale eligibility without abandoning active rides; see [payout account events](57-payout-account-reconciliation.md).

Driver directions now recheck trip authorization and endpoint freshness before external Maps handoff; see [driver navigation](58-driver-navigation.md). Real device navigation remains unverified.

An Expo push transport adapter now validates generic hints and handles tickets/receipts; see [push notifications](59-push-notifications.md). Versioned installation registration, ownership transfer and stale-receipt fencing are implemented with migration/API/client tests. Native opt-in controls, secure retry journals, permission/token refresh and normal sign-out revocation are wired; real provider/device verification remains. Durable delivery consumers and notification-tap handling remain unimplemented.

## Delivery instructions

The user authorized building and verifying the complete mobile product, deferring paid account setup and final business decisions to the handoff, and pushing the result to `main`. The current implementation is being committed as an intermediate checkpoint at the user’s explicit request. This push does not represent completion of the full product. No production deployment is included.

The local synthetic rates are fixtures, not approved customer pricing. Do not enable real bookings until provider setup, policies and launch checks are completed.

## Notification tap routing

Both native apps now consume notification responses through a shared strict hint contract and fresh account-authorized resource reads before opening fixed trip/offer screens. Signed-out taps are discarded; late account work, duplicates and expired offers cannot navigate. Six controller tests bring the workspace total to 365. See [notification implementation and limits](59-push-notifications.md#notification-taps). Real OS delivery/tap verification and the delivery worker remain incomplete.

## Push recipient authorization

The shared server now resolves queued notification recipients from current database ownership, configured app projects, enabled accounts and exact registration revisions. It suppresses old registrations/events and invalid driver offers, with eight PostgreSQL behavior tests. This resolver is ready for the pending durable delivery/receipt worker; it is not yet wired into runtime sending. See [delivery recipient authorization](59-push-notifications.md#delivery-recipient-authorization).

## Durable push delivery

The opt-in hosted push worker now composes ride/offer fan-out with existing financial handlers, records send/receipt state, fences concurrent and delayed work, enforces a shared project send budget and recovers stalled jobs. Migration 0023 is tested locally. Fourteen PostgreSQL orchestration tests and runtime tests with delivery off/on cover this integration; real APNs/FCM delivery remains unverified and delivery defaults off. See [durable delivery and setup](59-push-notifications.md#durable-delivery-and-receipts).

## Notification device management

Rider and driver accounts can list and turn off owned notification devices with explicit confirmation and server revision checks. Passive refresh respects revocation until explicit opt-in. All 397 workspace tests and both new browser flows pass; both iOS simulator flows passed against synthetic local registrations, with screenshots in [notification device management](59-push-notifications.md#account-device-management). This controls notifications only, not authentication sessions. Real provider/Android verification and retention cleanup remain unfinished.

## Neon staging database — September 8, 2026

Created an isolated schema-only `rove-staging` branch in the existing Rove Neon project and applied all 24 migrations through `0023_push_deliveries`. Added explicit migration, restricted application-role provisioning and synthetic backend smoke commands. Verified TLS, pooled role restrictions, booking retry, matching, full trip completion, synthetic capture/receipt, ownership rejection, cancellation/hold release and persisted reads. See [Neon staging](60-neon-staging.md) for configuration and limits. No production migrations, real provider calls, public API deployment or mobile endpoint changes are implied.
