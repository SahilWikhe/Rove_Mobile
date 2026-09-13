# Implementation status

Updated: September 12, 2026. The newest checkpoints below identify the source revision and verification scope for each result. Historical checkpoints retain their original limitations. This records implementation and evidence, not production readiness or a percentage-complete estimate.

## iOS native location display and expiry verified — September 12

The recorded two-app location scenario passed in 268.132 seconds with zero failures, continuing through completion and the paid synthetic receipt. During pickup and in-progress states, the peer uploaded three changing samples and verified exact assigned-rider API responses. The native Follow driver control recentered the Google map; inspected screenshots show the blue driver marker and the latest sample timestamp in both phases. After updates stopped, both screenshots and native assertions confirmed marker/reporting-time removal and the unavailable message after normal expiry (22:02:29.316 and 22:03:54.589 PDT).

Artifacts, JUnit, peer/event logs and the owned-simulator recording are preserved under reports/native-trip-ios/details/2026-09-12_215940. The earlier unexpected return home did not recur. Source inspection found no location-expiry navigation action and no recent Rove crash report; its cause remains unresolved, so no navigation fix is claimed. This passing run proves one native lifecycle scenario, not absence of intermittent faults.

Added optional NATIVE_RECORD_VIDEO capture to the iOS runner, stopping it with bounded shutdown before deleting the owned simulator. Tooling lint/formatting, docs and diff checks passed. No application behavior or hosted configuration changed. Next: Android location display/expiry acceptance, then broader physical/provider verification and remaining Figma/erasure/production work. Synthetic samples and visible Google tiles do not prove physical GPS, locked-phone uploads or full navigation-provider acceptance.

## Native location freshness acceptance in progress — September 12

Added an optional pickup/in-trip native location subflow and loopback-only synthetic location peer. The peer uploads three changing samples in each phase and verifies the assigned rider API returns the exact coordinates/sample time, then stops updates so normal expiry can occur. Both runners expose the optional switch. No app GPS or expiry behavior changed.

The first iOS attempt failed at initial sign-in before creating a ride; local API/proxy health and an empty ride list were verified afterward. A fresh simulator retry reached pickup, read all three samples, showed the latest reporting time and passed stale-location removal/unavailable state. In-trip sampling also completed and its reporting time appeared, but the rider unexpectedly returned to the home screen before the expiry assertion; that run remains failed. Evidence is retained under reports/native-trip-ios/details/2026-09-12_214947, with failure.png at the parent report directory. No full location pass is claimed.

Screenshot inspection shows Google tiles, correcting the earlier assumption that this run used Apple preview. The test scroll panned the map away from the driver, so the subflow now selects Follow driver before its visual capture; that refinement has not yet passed a run. Targeted tooling lint/formatting and documentation/diff checks passed. Next: diagnose the unexpected in-trip navigation and rerun with explicit camera following, then Android map/location acceptance. Physical GPS, locked-phone delivery, remaining Figma, erasure and production setup remain open.

## Android native outage and reconnect acceptance — September 12

The complete Android outage variant passed in 189.396 seconds with zero failures. Both normal foreground message exchanges passed; the rider then remained in its conversation during an eight-second socket outage, recovered the outage reply through HTTP fallback, received a later pushed reply after a fresh ready socket, and returned through the driver's recovered conversation to complete the trip and rider paid synthetic receipt. The runner exited zero and removed its owned emulator.

The outage reply assertion completed at 21:40:21.048 PDT before fault-ended at 04:40:21.952 UTC. Connection 41 became ready at 04:40:29.451 UTC, received messages.changed at 04:40:34.538 UTC, and the final reply assertion completed at 21:40:35.283 PDT. Per-run JUnit, screenshots and proxy/peer logs are preserved under reports/native-trip-android/android-driver-details/2026-09-12_213752.

The first outage variant recovered both replies but failed after returning to the driver because the older rider message had scrolled out of view. The shared test now scrolls upward to that message instead of assuming it remains visible. No app behavior was changed. Formatting, documentation and diff checks passed. Android and iOS now each have a passing local foreground fallback/reconnect scenario; this is not background/locked-phone or hosted-provider acceptance.

Next: native location display/update/freshness coverage. Current synthetic iOS can use the existing Apple map preview; the synthetic Android Metro setup needs its map configuration for visual map acceptance. Full Google/physical-device verification, Figma completion, data-erasure fulfillment and production setup remain open. No hosted mutation or production activation occurred.

## iOS native outage and reconnect acceptance — September 12

The optional rider conversation outage scenario passed inside the complete two-app iOS trip in 142.413 seconds with zero failures. The native rider remained in its conversation while the owned loopback proxy dropped sockets and rejected upgrades for eight seconds. A synthetic counterpart posted during the outage; the rider displayed that message at 21:28:47.391 PDT, before the fault ended at 04:28:48.493 UTC. This confirms HTTP fallback recovery, not WebSocket delivery during an outage.

A fresh socket (connection 12) became ready at 04:28:56.585 UTC. The peer waited five more seconds, posted the second reply, and that socket received messages.changed at 04:29:01.633 UTC. The native assertion completed at 21:29:01.800 PDT. Screenshot inspection confirms both replies; the scenario then completed the ride and paid synthetic receipt. JUnit, screenshots and proxy/peer logs are preserved under reports/native-trip-ios/details/2026-09-12_212652. The runner exited zero and removed its simulator.

Added opt-in reconnect switches to both runners and a shared rider subflow. The peer requires the explicit owned proxy PID/log and fault-start confirmation before posting, then a new ready event after fault-ended before the final reply. No app/API behavior or hosted configuration changed. Tooling lint/formatting, documentation and diff checks passed. Android has not run this outage variant yet. Next: Android reconnect and native location coverage, then physical/provider acceptance; Figma, erasure and production setup remain open.

## Native reconnect fault tooling — September 12

Added opt-in socket fault injection to the loopback observation proxy. Signaling only its owned PID creates an eight-second WebSocket outage while preserving HTTP fallback. Regression verification passed for active socket termination, rejected upgrades, continuing HTTP traffic, fresh stream readiness after recovery and omission of private data from logs. Both proxy tests and targeted lint/formatting passed.

This prepares controlled native reconnect acceptance; it is not a native reconnect pass. No API, client, hosted service or provider configuration changed. Next: exercise the fault while a native conversation remains open, check missed-message recovery and subsequent delivery on a fresh ready connection, then native location coverage. Physical/provider, Figma, erasure and production-release work remain open.

## Complete iOS trip and both message recipients verified — September 12

The full two-app iOS 26.5 simulator scenario passed in 116.546 seconds with zero failures: synthetic sign-in, driver availability, rider booking, offer acceptance, both native composers sending and receiving delayed counterpart messages, driver conversation recovery, pickup/arrival/start/completion and the rider paid receipt. The inspected receipt shows $11.85 quoted and captured, Ride: completed and Payment: paid. This is a synthetic provider result, not a live payment or payout.

Preserved JUnit, screenshots and event/peer logs under reports/native-trip-ios/details/2026-09-12_211812. Delayed replies were posted at 04:19:35.642 and 04:19:50.803 UTC, with native visible assertions at 21:19:35.763 and 21:19:50.957 PDT. WebSocket events preceded these assertions. The runner exited zero and removed its owned simulator.

The failures were resolved in the shared acceptance selectors: use the existing message-input ID and match message bodies within iOS's grouped sender/body/time accessibility labels. No application layout, spoken labels, warning suppression or business logic changed. Earlier warning-overlay observations did not establish a composer defect; the corrected scenario successfully used it. Android's previous full pass remains valid for its earlier selectors; the revised shared selectors have now passed iOS. Formatting, documentation and diff checks passed.

Next: native location/reconnect coverage, followed by physical locked-phone and live-provider acceptance. Remaining Figma/UI work, data-erasure fulfillment and production setup remain required. No hosted migration, cleanup activation or production activation occurred.

## Both Android participants receive live messages; iOS trip verification started — September 12

The expanded two-app Android scenario passed in 149.513 seconds with zero failures. Each native participant sent a message and stayed in its conversation for a delayed reply from the dedicated synthetic counterpart. The driver then reopened its conversation and saw the rider's message; the scenario continued through the completed ride and paid rider receipt. Per-run JUnit, proxy/peer events and screenshots are retained under reports/native-trip-android/android-driver-details/2026-09-12_205948. Ready WebSocket connections 45 and 48 received messages.changed at 04:01:31.521 and 04:01:49.659 UTC; native assertions completed at 21:01:32.221 and 21:01:50.376 PDT. These are observed local foreground events, not production latency guarantees.

The rider test now waits for the confirmed-driver screen before pulling the lower panel upward; earlier attempts dragged the map or acted before that screen was ready. No trip rule or app UI was weakened. The synthetic peer now supplies both delayed replies. Added an iOS two-app wrapper around the existing isolated simulator lifecycle runner.

The first iOS trip run reached the accepted trip and driver conversation, then failed to find the Message composer before sending. Its screenshot shows a debug warning banner overlapping the composer; Metro recorded onAnimatedValueUpdate with no listeners. The root cause remains unresolved. Evidence is retained under reports/native-trip-ios/details/2026-09-12_210420 and reports/native-trip-ios/failure.png. No warning suppression or iOS pass is claimed. The runner removed its owned simulator.

Targeted tooling ESLint/Prettier, all 86 documentation files, diff checks and both proxy forwarding/log-redaction regression tests passed.

Next: resolve the iOS composer obstruction and verify the same full trip/message scenario, then native location/reconnect and physical/provider acceptance. Remaining Figma, data-erasure fulfillment and production setup remain open. No hosted migration, cleanup activation, provider change or production activation occurred.

## Android foreground WebSocket messaging acceptance — September 12

The optional messaging segment passed inside the complete Android trip scenario in 125.4 seconds. The native driver opened Message rider, typed/sent the test message, stayed in the conversation while a dedicated synthetic rider peer replied after a five-second delay, saw the reply, returned through View this trip and completed the ride through the rider's paid receipt. The final conversation screenshot was inspected.

A loopback-only transparent proxy recorded a ready native WebSocket (connection 14), the remote reply's messages.changed event at 03:41:55.609 UTC, and Maestro confirmed the reply visible at 20:41:55.690 PDT before leaving the conversation. The synthetic peer timestamp matches the event. This is observed local foreground delivery, not a production latency promise. JUnit, event/peer logs and screenshots are retained in reports/native-trip-android/android-driver-details/2026-09-12_204016. The earlier attempt received the reply but failed when hideKeyboard navigated back after the keyboard was already closed; that redundant test action was removed.

Added reusable local proxy/peer tooling and an optional subflow instead of duplicating the base ride scenario. Proxy regressions passed for HTTP/WebSocket forwarding, omission of tokens/content from its log and invalid/equal ports. Targeted tooling lint, formatting and documentation checks passed. No app messaging implementation or provider configuration changed.

This proves native Android driver send/foreground receive with a synthetic counterpart plus a complete ride. Native rider foreground receiving, iOS messaging/trips, reconnect/background/locked-phone behavior, live Auth0/provider acceptance, location coverage, remaining Figma/data-erasure work and production setup remain open. No hosted migration, cleanup activation or production activation occurred. Next: iOS native trip/messaging acceptance and rider location/realtime coverage; owner decisions remain final-handoff items except the separately pending Google coordinate-use approval.

## Complete Android rider–driver trip acceptance — September 12

The two-app native scenario passed on one fresh API 36 emulator in 122.2 seconds. It signed in both synthetic identities, made the driver available, searched Home/Work places, reviewed/requested the rider fare, opened and accepted the driver's offer, confirmed heading to pickup/arrival/start/completion, then opened the rider receipt and asserted Payment: paid. The runner exited zero and removed its owned emulator/AVD. JUnit and both screen captures are retained under reports/native-trip-android/android-driver-details/2026-09-12_202514.

Inspected the rider receipt: $11.85 quoted and captured, Ride: completed, Payment: paid. The driver screenshot was captured before asynchronous settlement and showed estimated earnings/payment processing; it is not proof of a completed payout. Earlier failed runs remain failed evidence. The passing flow uses real upward panel drags, bounded settling waits around countdown controls, and a scroll after the completion heading. This avoids relying on a stale Android accessibility snapshot for the panel handle. No offer timeout or ride rule was weakened.

The two-app emulator now receives 4 GB of RAM (single-app runs retain 2 GB), and runtime diagnostics include Android warnings and lmkd messages. The passing run had no device-server disconnect; this alone does not prove memory caused earlier failures. Runner lint/formatting passed. Setup documentation records the local-only scope. No application business logic, hosted migration, production activation or cleanup setting changed.

This is a synthetic Android booking-to-receipt pass, not live Auth0/Stripe/Google acceptance, iOS trip acceptance, real payout verification, native realtime-message/location coverage or locked-phone tracking proof. Next: extend native acceptance to realtime messaging/location and iOS, while retaining the remaining provider, Figma, data-erasure and production-release requirements. Pending Google route-coordinate approval remains separate.

## Two-app Android trip acceptance in progress — September 12

Added a local two-APK trip runner and shared Maestro booking-to-receipt scenario. The Android lifecycle runner validates both Debug packages, assigns separate Metro ports, switches between the rider and driver apps on its owned temporary emulator, preserves artifacts and cleans up afterward. Setup and limits are documented in the CI/environment runbook.

Native evidence now confirms driver synthetic sign-in/online availability, rider sign-in, Home/Work place search, quote/request and a visible driver ride request. Two attempts lost ADB transport during Maestro's default launch-time permission setup; `permissions: {}` allowed the next app switch to complete. That run then failed because the request action was underneath the floating bar. The scenario now explicitly expands the driving and offer panels before accessing actions. The expanded-panel run then exhausted the offer window while Maestro waited about 12 seconds before the handle tap. Countdown-facing test actions now bound screen-settling waits to 500 ms without changing offer expiry. The latest run failed earlier with DeviceServerDiedException during destination entry; its JUnit and screenshot remain under reports/native-trip-android. No complete-trip pass is claimed.

Targeted runner ESLint/Prettier, documentation/diff checks and all three native process-wrapper regressions passed; formatting/documentation checks also passed after the panel/settling edits. No application business logic, production authentication, hosted migration, cleanup activation or production deployment changed. Full native acceptance, live providers, physical locked-phone tracking, remaining Figma UI and data-erasure fulfillment remain open. The pending Google route-coordinate approval remains separate.

Next: finish native acceptance through pickup, completion and rider paid receipt, then broaden to realtime messaging/location and the other platform.

## Android account acceptance — September 12

Added the Android account runner with APK package/debuggable validation, isolated temporary AVD ownership, local Metro/API forwarding, retained Maestro/JUnit/runtime evidence and cleanup. Both current Android Debug builds succeeded using existing generated projects/caches and ARM64 compilation. Driver sign-in/deletion/withdrawal passed before the requested pause (33.5 seconds); after resuming, rider passed (48.5 seconds) and both runner processes exited cleanly.

The first rider flow tapped a deletion row underneath the floating navigation overlay. Scroll targets now center in the viewport before actions; no app padding, navigation or business logic was changed. The rider final screenshot was inspected. Driver's earlier pass used the pre-centering flow; the modified flow has not been rerun across every previous platform. Android setup uses only the new app's debug-server preference and directly launches MainActivity after the emulator rejected the system-property and generic Monkey launch attempts.

Changed runner lint, formatting, documentation and diff checks passed. The Android runner remains local acceptance tooling rather than a hosted authenticated CI job. These results use synthetic identities/providers and do not prove live Auth0, real payments, full native rides, background tracking on locked phones or production readiness. No hosted migration, cleanup activation or production setup was performed.

Next priority: full native booking → matching → pickup → trip completion and receipt acceptance, followed by real-provider/physical-device checks. Data-erasure fulfillment and remaining Figma/production acceptance remain incomplete. Separately requested Google route-coordinate approval remains pending.

## Repeatable native account journeys and startup import fix — September 12

Added `scripts/ios-account-journey.mjs` to validate the requested Debug artifact and local Metro, create a fresh simulator, run the shared account flow, retain JUnit/logs/failure screenshots and remove only that simulator. API and Metro remain caller-owned. Driver Debug compilation succeeded with temporary simulator signing entitlements and existing native projects/caches; rider reused the earlier signed Debug binary. Current JavaScript was served through isolated synthetic Metro/API instances.

Native investigation found visible sign-in controls could be tapped before session readiness. The flow now waits for enabled controls and verifies Edit profile after Account navigation. It retains screen/command timeouts and does not retry taps automatically. Also removed the shared UI barrel's circular EmailVerificationNotice re-export: both entry screens use its explicit package subpath. Clean Metro bundles no longer emit that require-cycle warning. No LogBox suppression, navigation timing delay, focus-wrapper change or authentication bypass is retained. Earlier failed flows remain failed evidence, not passing runs.

Verification: the complete driver sign-in/deletion/withdrawal flow passed twice on fresh iOS 26.5 devices; the updated rider flow passed on another fresh device. All runners exited cleanly and removed their devices. Five browser account regressions passed, both app and shared UI typechecks passed, targeted lint/format, workspace boundaries, documentation and diff checks passed. The driver final screenshot was inspected. This does not prove Android authenticated journeys, live Auth0, physical-device behavior or store-signed releases. Earlier source `fa9b959` hosted CI was still running at the latest check; current-main hosted success is not claimed.

Next: Android authenticated account/trip journeys, remaining native/provider/physical acceptance and retained-data cleanup fulfillment. No hosted migrations or cleanup/production activation occurred. Overall completion and the separately pending Google coordinate-use approval remain open.

## Native rider deletion journey and full browser regression — September 12

Added a reusable Maestro account-deletion flow and local setup instructions. On a dedicated iOS 26.5 simulator, the rider Debug app signed in through the synthetic session, opened Account, submitted deletion consent and withdrew it. JUnit reports one passing flow in 12.4 seconds; the final screenshot was inspected and shows the persistent withdrawn confirmation, fresh-request action and preserved support history.

The initial unsigned Debug build exposed a simulator Keychain failure that the Release welcome smoke could not detect. Rebuilding through Xcode with temporary simulator-only signing entitlements allowed SecureStore authentication without changing application security or production signing. An initial Account tap raced the home transition; the reusable flow now waits for animation completion before tapping. No application source was changed for these test setup corrections.

Verification on application source `fa9b959`: all 56 browser journeys passed in 6.6 minutes; rider Debug builds succeeded, and the final native account flow passed. Native projects and caches were reused. This is synthetic local verification, not live Auth0, Android/driver account coverage, store signing or physical-device acceptance. Current main hosted run 34729879073 was still in progress when checked. No hosted migration, cleanup activation or production change occurred.

Next: run the native account/trip journeys on the other app/platform combinations, complete provider/physical-device acceptance and remaining data-erasure fulfillment. The separately requested Google coordinate-use approval remains pending. Overall application completion is not established.

## Definitive document upload preflight failures — September 12

Migration 0047 records immutable `not_dispatched_at` evidence when the S3 adapter fails its read-only privacy/versioning preflight before invoking PutObject. The tracked store commits that outcome with its audit; matching error text cannot create proof, audit failure leaves the intent unresolved, and database constraints forbid clearing the outcome or replacing it with a successful version. Pending-upload inspection and cleanup barriers exclude only these proven non-dispatched intents. Reservation expiry, account closure, retention holds and inventory requirements remain in force.

Separated the adapter's preflight and write error paths. Errors after invoking PutObject, malformed receipts and timeouts remain uncertain, even when an injected write error resembles the internal pre-dispatch type. No age-based settlement, provider-absence assumption, real file operation or AWS permission change was introduced. Existing uncertain attempts are unchanged.

Verification: 36 focused storage/write/cleanup tests passed; all 11 application test tasks passed (four unchanged tasks cached), workspace/E2E types, full source lint, API build, schema/snapshot no-diff and docs checks passed. No mobile UI changed. Hosted CI run 34728867127 remained in progress for older `a01b7bd`; latest `0d31934` was pending and superseded pending withdrawal run was cancelled. This does not establish current hosted success.

Migration 0047 remains local, to be applied before compatible HTTP/worker deployment together with predecessor rollout requirements. Cleanup remains off. Next: reconciliation of genuinely dispatched/uncertain writes and presigned inbox activity, retained application/backup data fulfillment and remaining native/provider/Figma acceptance. Full application completion is not yet established.

## Source lint excludes generated reports — September 12

The withdrawal checkpoint's full lint invocation picked up the untracked `reports/push-reset-ui` generated bundle and diagnostic harness. Added the already git-ignored reports directory to ESLint's generated-output exclusions; source application and test rules remain unchanged. The earlier checkpoint's lint wording is corrected rather than treating that failed invocation as success. The full source lint rerun passed with zero warnings/errors. Next: preserve migration rollout limits and continue uncertain-upload/data fulfillment and native/provider acceptance.

## Pending deletion withdrawal — September 12

Implemented withdrawal before closure for both rider and driver. Migration 0046 preserves immutable consent fields and adds a one-way withdrawal timestamp, keeps one active request per owner, and rejects closure against withdrawn consent. Owner-first consent locking serializes withdrawal with staff closure. Authenticated owner-only, idempotent withdrawal audits atomically; disabled accounts cannot replay. A later explicit request creates fresh consent and a new support reference. Older command replays cannot reactivate consent or cancel the newer request.

Both apps expose a confirmation and Keep deletion request alternative, persist the withdrawn state, retry lost responses with the same key and reload authoritative status before enabling a fresh request. Support history tests now identify records by unique references because different consent requests can legitimately contain identical text.

Verification: all 11 application test tasks passed (five unchanged tasks cached); 18 focused consent/closure database tests passed, including ownership, immutable history, audit rollback, retries and concurrent closure. Seven browser deletion/support journeys passed after correcting the synthetic-session reload setup and duplicate-message locator assumption. Workspace/E2E types, both mobile exports, schema/snapshot no-diff check and docs checks passed. The first full lint attempt scanned ignored generated reports and failed there; the follow-up excludes reports from source lint and records the rerun below. The rider 390px withdrawn-state screenshot was inspected. No new native binary/physical-device or real-provider acceptance is claimed.

Hosted migration/activation was not performed. Migration 0046 requires a coordinated API/schema rollout because old unconditional owner-conflict inserts are incompatible with its partial index; the full drain/migrate/compatible-host/release sequence and older-client enum limitation are documented in docs/75-account-deletion.md. Account closure and document cleanup remain off. Next: uncertain-upload reconciliation and retained-data fulfillment, remaining native/provider/Figma acceptance, and the separately pending explicit Google route-data approval. Production setup and final policy decisions remain open.

## Fresh local Android release verification — September 12

Built both Android Release APKs from revision `cd45732afea4aca62177102c6dbc813fa2222ab4` (application code unchanged from `c26bf2d`), using the existing generated projects, Node 24, Java 21 and the installed Android SDK. Builds ran sequentially against shared local native outputs, regenerated their JavaScript bundles and succeeded in synthetic mode with dotenv loading disabled. Both APKs contain nonempty embedded JavaScript.

Rider and driver independently passed the unchanged standalone welcome/relaunch test on fresh API 36 ARM64 Google APIs emulators. The wrappers used distinct emulator ports and removed their disposable AVDs afterward. Existing user devices were not reused. Combined with the fresh iOS evidence below, all four app/platform combinations now have current-code local Release startup verification. Android used existing native projects/caches and local ARM64 emulators, not a clean hosted x86 build or store-signed release.

No application code or cloud setting changed in this checkpoint. Remaining acceptance includes full native authenticated journeys, real integrations, locked-phone GPS/push/navigation and production release setup. Google rider route-line implementation remains unapplied pending the explicit data-use approval requested after automatic review rejected it. Cleanup reconciliation/retained-data fulfillment and remaining Figma journeys are still incomplete.

## Fresh local iOS release verification — September 12

Built rider and driver Release simulator binaries from application source `c26bf2dd2541d303f993feeffee86c6a8b7363cc`, using the existing generated native projects and separate derived-data caches. Both builds succeeded with synthetic mode, dotenv loading disabled and code signing off. Corrected the driver's ignored local `.xcode.env.local` from Node 26 to the repository-required Node 24 runtime before building. Generated native projects were reused, so this is not a fresh-prebuild/store-signing acceptance claim.

Both newly built artifacts passed the unchanged standalone welcome/relaunch flow on separate fresh iOS simulators using the six-minute wrapper. Each contained its JavaScript bundle, showed Get started, relaunched successfully and exited cleanly; the wrapper removed both disposable simulators. These tests replace older-artifact smoke evidence for the current application source. They do not authenticate or test real rides/providers, background GPS or physical devices.

Hosted run 34726005360 remained active at the last read, compiling both iOS Release binaries for its older `8408636` revision. Latest-main hosted acceptance remains unproven. Next: remaining native journeys/Android and physical-device acceptance, uncertain-upload/data cleanup and the separately pending Google route-data approval. The complete application objective remains open.

## Durable deletion status in both apps — September 12

Connected both account-deletion screens to the existing typed `GET /v1/account-deletion` client method alongside support history. A resolved support ticket no longer makes the form offer another deletion request. Failed initial/status refresh blocks confirmation until reload; lost submission responses still retry the original idempotency key. The shared card distinguishes support resolution from account/data erasure. No backend mutation, retention policy, external provider flow or migration changed.

Workspace/E2E types and changed-source lint passed. Seven focused browser journeys passed for rider/driver deletion and ordinary support, including resolved-ticket persistence, unavailable status, lost-response recovery and signed-out links. Both final mobile export builds passed. The rider 390px screenshot was inspected for readable status copy. No fresh native binary or physical-device acceptance is claimed.

Automatic review separately rejected the proposed new rider route-geometry flow twice for requiring explicit permission to send active-trip endpoints to Google. That patch did not execute and remains pending user approval; the automatic goal continuation is not approval. Next: approved route-line work, uncertain-upload reconciliation, retained-data cleanup and remaining Figma/native/provider acceptance. Production setup and owner policy decisions remain final handoff items.

## Current-main full local regression — September 12

Verified source revision `91afa4379aa40c8de7df41d55c399f3fdb00d2cb`: all eleven application test tasks passed (five unchanged tasks used valid Turbo cache), and all 56 browser journeys passed against isolated synthetic services in 5.7 minutes. Coverage includes the full rider/driver trip lifecycle, real search-expiry timing and explicit fresh-quote retry, document/setup recovery, messaging access, payouts and local-storage recovery. No application source changed during verification.

At the last hosted read, run 34726005360 was still building both iOS debug binaries; current-source run 34727291502 was pending behind it. Superseded pending runs for `fa128c9` and `6bc9e70` were cancelled. This does not establish hosted success for the six-minute native runner adjustment. Local browser tests do not verify native maps/navigation, physical locked-phone GPS, real payment/provider credentials or production readiness.

Next implementation gaps remain rider route-line geometry (the shared Google route response currently returns distance/duration only), remaining Figma/native acceptance, verified uncertain-upload reconciliation and retained-data/backup cleanup. The full objective remains incomplete; production and owner policy decisions remain final setup items.

## Audited upload-blocker inspection — September 12

Added shared `DocumentUploadInspection` and staff `GET /v1/staff/documents/:id/upload-inspection`, with MFA/current `privacy.read`, transactional audit and document-scoped cursor pagination. The view reports reservation expiry/activity, account-access closure and unresolved write keys/timestamps without document contents or provider calls. It does not settle ambiguous writes, override barriers or claim full quiescence; it shares the cleanup feature's default-off availability.

Ten focused storage-write tests and three cleanup runtime/API tests passed, including 102-write pagination, document isolation, denied consumer/MFA/revoked access, default-off routing and inspection leaving unresolved writes blocked. The existing retry test exposed a database microsecond/worker millisecond scheduling race; bounded polling now waits for the scheduled job instead of assuming immediate eligibility. Workspace/E2E types, changed-source lint and packaged API build/authentication checks passed. No migration or hosted configuration changed.

Next: resolve uncertain writes through verified storage/write-quiescence evidence, then live synthetic cleanup acceptance and retained-data/backup handling. The inspection API is implemented, but staff-dashboard integration remains in its separate repository. Remaining Figma/native/provider acceptance and production setup are not complete.

## Restricted staging cleanup role and metadata-only verification — September 12

Created the separate staging cleanup CloudFormation role using only the verified `claude-agent` operator. Persisted that identity requirement in `AGENTS.md`. The role allows bucket-versioning checks, prefix-restricted version inventory and exact-version deletion, without document reads, writes, unversioned deletion or governance bypass. Template lint/CloudFormation validation and Access Analyzer checks passed; deployed trust/sole inline policy readback matched the reviewed template and all thirteen allow/deny simulations passed. No S3 objects, bucket policies, hosted migrations or deployment settings changed; cleanup remains off.

Replaced erasure HEAD checks with complete validated version inventories before and after deletion, sharing the runtime's dedicated OIDC inventory provider. This avoids requiring quarantine content-read permissions. Failed/partial discovery cannot establish absence. All eleven local application test tasks, 38 focused inventory/erasure tests, workspace/E2E types, 63 tooling tests, changed-source lint and packaged API build/authentication checks passed. Role simulation and local tests do not establish a live Vercel OIDC/S3 cleanup or full account erasure.

Next: live synthetic OIDC/storage acceptance, uncertain-write/inbox reconciliation, residual versions/copies, retained-data anonymization and backup replay. Figma/native/provider/physical-device acceptance and production setup remain incomplete. See [role scope and verification](77-document-cleanup-plans.md#dedicated-staging-role-and-absence-verification).

## Hosted iOS smoke deadline investigation — September 12

Inspected job 103638208050 in hosted run 34725187223 (`a6991735`). Both driver iOS builds and the embedded JavaScript check passed. Retained Maestro output and JUnit report show the unchanged welcome/relaunch flow passed in 48 seconds with zero failures; the enclosing command then hit its three-minute deadline. Cold runner startup consumed roughly two minutes before the flow. Increased only the iOS whole-command deadline to six minutes, preserving 60-second screen waits, nonzero-exit failure handling, diagnostics and disposable-simulator cleanup. A passing report does not override a command failure.

All 63 local tooling tests, changed-source lint/format, documentation, boundaries and diff checks passed. The adjusted wrapper also passed the unchanged driver welcome/relaunch flow on a fresh local iOS simulator and exited cleanly; the disposable simulator was removed. This reused an existing synthetic release artifact, not a new build of current main. The linked hosted run finished with rider iOS and all other substantive jobs passing; driver iOS and its dependent CI gate failed. This is a bounded timeout adjustment based on hosted evidence, not proof that hosted runner shutdown or current-main CI is fixed. Next: confirm a fresh hosted run. The separately in-progress cleanup role/provider changes are not part of this CI patch; cleanup remains off. Remaining release priorities are retained-data cleanup, Figma/native/provider acceptance and production setup.

## Approved default-off cleanup connection — September 12

The user explicitly approved the previously blocked staff/runtime connection for approved document versions in the existing private bucket using a separate limited AWS cleanup role, with activation off. Implemented strict enable/policy/storage/role configuration, staff prepare/inspect/approve/retry routes, durable outbox registration and dedicated Vercel OIDC credentials for the existing inventory/erasure adapters. The role must belong to the storage owner and differ from configured upload/scanner roles. Cleanup never falls back to upload/ambient credentials. No real files, cloud permissions, environment settings or hosted migrations changed.

All eleven local application test tasks passed. Four focused config/runtime tests passed, including an authenticated API-to-worker synthetic version removal, invalid approval, MFA/access checks, disabled mode, failed provider recovery and no duplicate removal after replay. Workspace/E2E types, changed-source lint and packaged API build/authentication checks passed. The final focused suite also passed after adding failed-provider recovery coverage. No native rebuild was needed for this backend-only checkpoint; these checks do not establish live IAM or storage acceptance.

Remaining cleanup work includes dedicated role provisioning and scan-tag/HEAD absence-policy acceptance, uncertain uploads/inbox quiescence, residual versions/copies, retained application-data anonymization and backup replay. The existing quarantine read deny can block verification for unclean versions; no broad bypass was added. Complete deletion is not claimed. Remaining Figma journeys, native/provider/physical-device acceptance and production setup remain priorities. See [cleanup routes, configuration and remaining work](77-document-cleanup-plans.md).

## Driver account activity and refresh — September 12

Reviewed driver Figma Account `4:106` and added the missing activity-card composition using shared dark surfaces and Manrope. Cards show recorded completed trips, accepted offers and registration month. These are factual totals, not the mockup's unimplemented rating or acceptance/completion percentages; those performance definitions remain unresolved. Account status now supports pull-to-refresh, cancels obsolete reads on focus/session changes, and removes prior activity values when refresh fails.

Added authenticated driver-only `GET /v1/drivers/me/activity`, strict shared/client contracts and a single-snapshot aggregate query scoped to the active driver. No rider identities, endpoints or other drivers' values are returned. Migration 0045 adds partial driver indexes for completed rides and accepted offers; no hosted migration was run. Deploy the API before the mobile screen; older APIs produce an honest unavailable state.

All eleven local application test tasks passed, including the new database totals/isolation/access tests and authenticated HTTP check. Three driver browser journeys passed, covering activity display, stale-value removal, account navigation and existing online controls. The 390px screenshot was visually inspected with readable, unclipped cards. Final focused database tests passed with migration 0045; workspace/E2E types, changed-source lint and packaged API build/authentication verification passed. This is synthetic local/browser evidence, not physical-device acceptance or full Figma parity.

Hosted run 34722464477 completed: general checks and both Android jobs passed; both iOS jobs failed. Native diagnostics were added in the later baseline above, so their value requires a later run. Cleanup runtime approval remains pending, with no destructive connection or activation added. Next: remaining rider/driver journeys, native/provider acceptance, retained-data cleanup and final production/policy setup.

## Native smoke diagnostics and local reproduction — September 12

Improved the iOS launch wrapper to retain Maestro stdout/stderr through timeout/nonzero exit, place flow/XCTest/debug artifacts under the CI-uploaded evidence directory, and capture a failure screenshot before deleting its disposable simulator. The command wrapper streams to disk without pipe-buffer limits. Assertions and the three-minute Maestro deadline are unchanged; failures remain failures.

All 61 tooling tests passed, including three new command-output/error/timeout tests. Changed-source lint, formatting, documentation, boundaries and diff checks passed. The updated iOS wrapper passed the unchanged welcome/account-entry/relaunch flow locally for both rider and driver using Maestro 2.10.0 on separate fresh iOS 26.5 simulators. Existing release binaries under local temporary build directories were reused; these checks establish those artifacts' launch behavior and wrapper behavior, not a new build or full acceptance of the current source revision. Both test simulators were cleaned up.

Hosted run 34722464477 for `5f174a1` now has both Android native jobs passing, alongside general quality, tests, browser, security, infrastructure, CodeQL and mobile checks. Both iOS jobs remained in progress at the last live read; the rider had reached the launch test after both builds completed. An earlier iOS run timed out inside Maestro, but its wrapper discarded detailed tool output. The current diagnostic improvement is not claimed to fix that timeout or prove latest-main CI success.

Cleanup runtime/staff API/AWS wiring remains unapplied pending explicit approval requested after automatic review rejected it. No permission was inferred from the automatic goal continuation. Independent native verification continued; remaining release work includes exact-commit hosted/native/provider acceptance, cleanup integration and retained-data/backup handling, Figma journeys and production setup. See [iOS smoke diagnostics](08-cicd-and-environments.md#ios-smoke-test-diagnostics) and [pending cleanup approval](77-document-cleanup-plans.md#pending-runtime-connection-and-approval).

## Durable document cleanup domain — September 12

Implemented per-document inventory manifests, immutable policy/review/quiescence approval, earliest execution time, per-version outbox jobs, durable dispatch/absence evidence, audited inspection and exhausted-job recovery. Preparation and approval recheck closed-account/write-settlement/retention barriers. Every new removal attempt rechecks those barriers; a later hold cannot suppress a confirmed earlier outcome. Prepared targets cannot be added/changed, and existing approvals cannot be rewritten. Delete markers remain separate from object removals; `versions_removed` refers only to the recorded plan, never account-wide erasure.

Migration 0044 adds plan/item constraints and evidence guards. Twelve focused PostgreSQL workflow tests and all eleven local application test tasks passed. Workspace/E2E types, changed-source lint, documentation, formatting, boundaries, schema no-diff verification and packaged API build/authentication checks passed. Initial fixture cleanup needed `TRUNCATE ... CASCADE`; this was corrected before final verification. No live provider calls or hosted migrations occurred.

Automatic approval review rejected the proposed staff HTTP/runtime/AWS-credential connection because irreversible S3 deletion requires explicit approval of target, role and blast radius despite a default-off flag. That command did not execute. The domain is not exported into or registered with runtime; no staff endpoint or credential wiring was added. The reviewable proposed connection uses only approved exact inbox/quarantine versions in the configured private document bucket and a separate cleanup role, with activation off. This connection awaits explicit user approval; other release work can continue independently.

Next: approved runtime integration plus unresolved-write/inbox reconciliation, residual-version discovery, retained application-data cleanup and backup replay. Remaining Figma/native/provider acceptance and production setup are still incomplete. See [document cleanup scope, verification and pending approval](77-document-cleanup-plans.md). Owner policy and paid setup decisions remain final handoff items.

## Durable storage-write settlement — September 12

Server quarantine uploads now commit an exact-key write intent and audit before provider I/O, after rechecking active driver ownership and reservation expiry under closure-compatible locks. Verified version receipts and settlement audits commit before attaching the document. Closure can proceed during provider I/O without losing confirmed write evidence; a later attachment rejection does not hide the orphaned stored version. Timeouts, crashes, malformed receipts and failed settlement transactions stay unsettled rather than becoming proof of no write.

Migration 0043 makes dispatch/result evidence immutable and rejects new writes for disabled accounts or mismatched reservations/paths. The new cleanup barrier requires a closed disabled account, expired upload reservations and no unsettled recorded writes. This is necessary but not sufficient for complete quiescence: accepted presigned inbox requests and legacy processes must still be accounted for. No arbitrary grace period is treated as proof that an external request has finished.

Twenty-four focused upload/storage tests passed, covering committed dispatch, closure races, disabled-owner rejection, replay, uncertain outcomes, immutable records, reservation expiry and both dispatch/settlement audit rollback. All eleven local application test tasks, workspace/E2E types, changed-source lint, docs, formatting, boundaries, schema no-diff verification and packaged API build/authentication checks passed. No hosted migration, real upload, cloud permissions or deletion activation changed.

Next is uncertain-write/inbox reconciliation and the durable approved cleanup manifest/worker using full version discovery, retention hold checks and dispatch/absence evidence. Retained application data, restore replay, remaining Figma/native/provider acceptance and production setup remain incomplete. Apply migration 0043 before deploying these upload paths and drain older upload processes before relying on the write ledger. See [storage-write settlement and rollout](75-account-deletion.md#storage-write-settlement-barrier). Final policy and paid setup decisions stay at handoff.

## Complete document-version discovery boundary — September 12

Implemented read-only S3 inventory for every inbox and quarantine attempt under a document reservation, including orphaned/unattached object versions and separate delete markers. Discovery carries both S3 pagination markers and validates exact document scope, bucket identity, complete pages and immutable version references. Repeated cursors, duplicate/conflicting versions, partial provider failures and bounded-volume/deadline failures cannot return a falsely complete partial inventory. The installed SDK lacks a version-list paginator, so this adapter explicitly implements the dual-marker sequence.

Seventeen focused inventory tests passed, including pagination across versions of the same key, orphan/marker discovery, cross-document rejection, partial failure and excessive inventory. All eleven local application test tasks, workspace/E2E types, changed-source lint, formatting, docs, boundaries and packaged API build/authentication verification passed. No live S3 listing, permissions, deletion or runtime cleanup activation changed.

Source inspection confirmed that an upload can write an orphaned quarantine attempt before the final account-state recheck, and inbox versions are not all represented by the attached document receipt. Consequently the cleanup manifest must consume full version discovery after fencing new/in-flight writes and previously issued upload forms, then persist authorization and per-version dispatch/proof with hold checks and rediscovery. That durable workflow remains the next work; a provider inventory is not an atomic storage snapshot or completed erasure. Other retained application data, backup replay, Figma/native/provider acceptance and production setup remain open. See [document discovery](75-account-deletion.md#document-version-discovery).

Hosted CI was freshly checked: run 34722464477 for `5f174a1` is in progress; run 34723684101 for `1ecff83` is pending. Intermediate queued revisions were cancelled/replaced. This does not establish latest-commit CI success; local verification continues as authorized.

## Exact-version document erasure provider — September 12

Implemented a server-only S3 erasure adapter for bound document inbox/quarantine versions. It validates document/key/version scope, configured bucket ownership, enabled versioning and exact-version metadata, deletes only that version and independently verifies absence. Lost-response retries recover without duplicating removal. Permission errors, missing buckets, malformed responses, delete markers, protected versions and objects that remain present cannot become success. Provider errors are sanitized; Object Lock/governance bypass is never requested.

All eleven local application test tasks passed. The final focused suite passed 22 tests after extending coverage to inbox versions; final server types and changed-source lint passed. Workspace/E2E types and packaged API build/authentication verification passed at the integrated checkpoint. Documentation, formatting and boundaries checks passed. Synthetic operation tests establish provider behavior, not live S3 acceptance or completed account erasure.

No runtime erasure route/worker, deletion credential, cloud permission, hosted migration or real object deletion was activated. Next is the approved cleanup manifest and worker: inventory all eligible versions/orphans, fence ongoing upload/access, persist dispatch/proof, and check holds before each destructive dispatch. Retained application data, policy classes and backup replay remain part of that work; full erasure is not complete. Remaining Figma/native/provider acceptance and production setup follow. Owner policy and paid setup decisions remain at final handoff. See [document erasure provider and setup](75-account-deletion.md#document-version-erasure-provider).

## Retention holds and durable identity dispatch — September 12

Implemented MFA-authorized staff hold placement, explicit release under a separate permission, and an audited review queue. Legal, safety and privacy holds can precede a deletion request or follow account closure. Review dates never automatically release holds. Database constraints preserve placement/release evidence and deduplicate active cases; queue cursors and duplicate-review checks preserve PostgreSQL timestamp precision.

Active holds block account closure and every new identity-removal attempt. The worker commits first-dispatch evidence before contacting Auth0, with network I/O outside database transactions. A later hold blocks retries but cannot recall an earlier external request; attempted and confirmed timestamps expose that distinction, and confirmed earlier outcomes can still be recorded. Migrations 0041/0042 add these controls without inventing historical dispatch timestamps.

All eleven local application test tasks passed. Final focused retention/closure tests passed fifteen checks, including microsecond precision, concurrent hold/provider dispatch, failed-provider evidence, MFA/permissions, audit rollback and immutable records. Twenty-three API runtime tests passed, including staff hold/release and blocked closure. Workspace/E2E types, changed-source lint, documentation, formatting, import boundaries, schema no-diff verification and packaged API build/authentication verification passed. These are synthetic local checks; no new native or hosted acceptance is implied.

No hosted migration, real provider deletion, closure activation or production configuration changed. Policy-driven retained application/storage cleanup and backup replay remain incomplete; this checkpoint does not claim full erasure. Next is the cleanup manifest and execution stages honoring these holds, followed by remaining Figma/native/provider acceptance and production setup. Owner policy decisions and paid setup remain final-handoff items. See [retention holds](76-retention-holds.md) and [account deletion](75-account-deletion.md).

## Authorized account closure and identity worker — September 12

Implemented default-off staff-authorized closure under an explicitly configured policy/review reference. MFA and `privacy.close` are required; active trips, unsettled payment status, nonzero owner ledger balances and queued/review-required refunds/transfers block closure. Payment rows serialize the financial observation with reconciliation. Closure atomically disables the account, clears current driver location, takes the driver offline, removes tracking credentials and saved places, disables/removes push tokens, records immutable approval/audit evidence and queues identity removal.

The runtime now wires the verified Auth0 adapter into the durable outbox worker. Identity removal is independently confirmed and retried; audited staff recovery requeues exhausted jobs without bypassing authorization or interrupting a live lease. Staff progress distinguishes `requested`, `closed` and `identity_removed`; none means full retained-data erasure. Migration 0040 protects closure evidence and disabled identity mappings, prevents closed accounts from becoming online or joining active rides, and preserves the original subject against stale-token re-registration. Onboarding also checks disabled state in its upsert, beyond middleware validation.

All eleven local application test tasks passed at the final checkpoint. Eight focused closure tests and 24 focused API/runtime/config tests passed. They cover actual PostgreSQL consent/closure/outbox sequencing, MFA/permission/policy failures, booking-lock races, retained rider funds and pending payment holds, token/location revocation, stale-token HTTP/onboarding rejection, audit rollback, immutable evidence and dead-letter recovery. Workspace/E2E types, changed-source lint, import boundaries, formatting, documentation checks, schema no-diff verification and packaged API build/authentication verification passed. No new mobile UI/native build acceptance is implied.

No hosted migration, closure activation, real identity deletion or production configuration changed. `ACCOUNT_CLOSURE_ENABLED=false` remains the default; enabling it requires dedicated Auth0 credentials and the approved policy reference on HTTP/worker hosts. Name/history/messages/document storage/payment bindings and other retained records still require policy-driven cleanup. Legal/retention hold management, review/withdrawal UI, full erasure evidence, backup replay and hosted/physical-device acceptance remain open. See [account deletion and closure rollout](75-account-deletion.md). Next priority is those retention and cleanup stages, followed by remaining Figma/native/provider acceptance and production setup; business/retention decisions and paid setup stay at final handoff.

## Durable account-deletion consent — September 12

Both mobile confirmation screens now send explicit versioned deletion consent. The support transaction records an immutable, account-scoped deletion request and its audit independently of the support ticket's resolution. Ordinary support prose is never converted to consent. Concurrent/replayed submissions deduplicate, and explicit new consent can attach to an existing account ticket. Migration 0039 enforces ownership, account category, consumer role and immutable consent; no hosted migration was run.

Added owner-only `GET /v1/account-deletion` and audited staff `GET /v1/staff/account-deletions/:id`, requiring dedicated `privacy.read` and MFA. The record honestly reports `requested`; it does not disable access, delete an identity or claim fulfillment. Existing support DTOs remain compatible. Deploy the migration/API before the consent-aware mobile release; older clients continue creating support requests without erasure authorization.

All eleven local application test tasks passed. Seventeen focused support/deletion domain tests passed, covering database ownership/immutability, staff permission/MFA, retries, ordinary-message isolation and audit rollback. Four rider/driver browser checks passed against the real disposable local API/database, including dropped-response recovery and signed-out protection. Workspace/E2E types, changed-source lint, boundaries, formatting, docs, packaged API build/verification and schema no-diff verification passed. No new native binaries, hosted provider acceptance or production activation is claimed.

Next: authorized fulfillment state, active-trip/financial/retention holds, local access revocation and identity-worker execution, followed by eligible data/storage cleanup and backup replay evidence. Remaining rider/driver visual/native/provider acceptance and production setup remain open. See [account deletion](75-account-deletion.md). Retention and paid setup decisions remain final handoff items.

## Account-deletion identity provider boundary — September 12

Implemented a server-only Auth0 identity-removal adapter with dedicated optional credential parsing, exact tenant-subject selection, minimal direct identity reads, matching-ID validation, encoded paths, delete and verified-absence recovery. Lost responses and already-absent identities can be recovered by a durable caller. Unexpected/malformed responses, rejected scopes and failed verification remain errors; credentials and provider details do not escape. Token acquisition is shared across concurrent calls, expires early and is invalidated after provider 401 responses. The adapter is not wired into a route or runtime worker; no credentials, real identities, cloud settings or production activation changed.

All eleven local application test tasks passed, including 548 server tests and 189 API tests. The final focused provider suite passed 21 tests after a lint correction, and API/workspace/E2E types, changed-source lint, import boundaries, formatting, documentation checks (84 files), packaged API build and build verification passed. These synthetic transport tests prove the adapter behavior, not hosted Auth0 access or end-to-end account deletion.

The active priority remains actual deletion fulfillment: explicit durable requests, policy/MFA authorization and holds, local access revocation, identity-worker orchestration, application/storage cleanup and backup replay evidence. The support screen still submits a support request; resolution is not deletion. Retention decisions and paid configuration remain final handoff items. See [account deletion implementation and requirements](75-account-deletion.md).

Hosted CI is active for `91cdc9f` (run 34720747399). Earlier run 34718799525 completed with general quality/test/browser/security/build checks passing; Android failed emulator preparation (explicit SDK path fixed in later source), while both iOS jobs failed release launch/account-entry checks. Inspect those native logs and verify the current run before declaring CI recovered. Remaining Figma/native journeys, provider acceptance and production setup remain open.

## Bank-payout history and driver presentation — September 12

Implemented a read-only connected-account payout provider, authenticated driver history API, strict shared contracts/client pagination, default-off runtime configuration and the driver Payouts screen. The screen separates bank/debit-card history from onboarding readiness, shows current provider status and estimated arrival dates, supports older pages, and clears stale status after failed refreshes. Existing dark surfaces and accessible controls are reused. Earnings now links to Payouts with a matching accessible label. Provider responses exclude bank identifiers/details, arbitrary metadata and failure messages; account binding and driver access are rechecked after provider reads.

All eleven local application test tasks passed, including 548 server tests and 168 API tests at the integrated checkpoint. Final focused provider/domain tests passed fifteen tests, the authenticated HTTP test passed, and the mobile client suite passed twenty-two tests. Workspace/E2E types, source lint excluding generated reports, boundaries, formatting, docs, packaged API build/health/authentication checks and rider/driver web/iOS/Android JavaScript exports passed. Five focused browser journeys passed, including Earnings navigation, payout setup, history pagination and clearing stale payout data after failure. The phone-width payout screenshot was visually reviewed with no amount/text clipping. Tests use synthetic provider data and disposable local PostgreSQL; JavaScript exports and browser evidence do not establish native device or real Stripe acceptance.

`PAYMENT_BANK_PAYOUTS_ENABLED` defaults off and requires verified Connect setup. No new migration, real provider request, withdrawal, schedule change or production activation occurred. This is account-level status, not a ride-to-bank allocation or bank balance journal. Physical-device/provider acceptance, payout policy and any automatic withdrawal/notification requirements remain explicit release decisions/work. See [bank-payout history and activation](74-bank-payout-history.md).

Next priority: actual account-deletion fulfillment and retention controls, then remaining Figma/native/provider acceptance and production setup. CI remains under verification: hosted baseline browser/security/quality tests passed, both Android builds reached the emulator stage (the SDK path fix is in newer main), and iOS jobs remained active at the last observation. New main runs queue without interrupting the active run; completed baseline checks do not prove the latest revision.

## Durable capture fees and transfer eligibility — September 12

Implemented migration 0038, immutable source-scoped capture balance bindings, separate processing-fee journals, explicit zero-fee records, revision-fenced provider observations, durable changed-fact review holds and bounded recovery sweeps. Full capture reconciliation queues fee accounting, including backfill for already-paid records. Transfers now require fresh verified fee accounting and refresh it before every new provider mutation; matching source charges and existing refund/dispute/recipient holds remain mandatory. Original gross fare and agreed driver earnings are unchanged. `PAYMENT_CAPTURE_ACCOUNTING_ENABLED` defaults off and is a required dependency for transfer activation. No hosted migration, financial flag activation, real Stripe request or production transfer occurred.

All eleven local application test tasks passed, including 533 server tests and 166 API tests. Focused API/runtime/scheduler tests passed 46 tests. Workspace/E2E types, source lint excluding generated reports, import boundaries, formatting, documentation checks, schema no-diff verification and packaged API build/health/authentication checks passed. Tests cover actual/zero fees, pending balances, provider-reference isolation, cross-payment balance reuse, missing gross capture, stale concurrent reads, audit rollback, immutable review holds, transfer reservation preservation and the full payment-reconciliation-to-outbox-fee-journal path. These are synthetic local tests, not provider acceptance.

Hosted baseline CI passed quality, tests, infrastructure, security, CodeQL, mobile bundling and browser checks. The Android driver debug/release builds succeeded but emulator preparation failed because `sdkmanager` was not on PATH. The workflow now uses its explicit Android SDK path, consistent with the launch script. Hosted proof of that fix and all native launch checks remain pending; other native jobs were still running at the last observation.

Next: bank-payout status/presentation and actual account-deletion fulfillment, then remaining Figma/native/provider acceptance and production setup. Reviewed corrections for conflicting provider fee facts, commercial payout/case-resolution policy and paid setup remain final handoff/release requirements. See [capture-fee workflow and rollout](73-capture-fee-accounting.md).

## Capture balance reader and uninterrupted main CI — September 12

Extracted a shared server-only Stripe capture-balance reader. It verifies the platform account, payment/customer/ride/attempt references, mode, full manual capture, currency, source charge and actual gross/fee/net arithmetic. It reports pending versus available observations and preserves the original processing fee when refunds or disputes occur. Missing/unexpanded balances fail closed rather than becoming zero fees. Driver transfer funding now uses the same reader and retains availability/dispute holds. This is the provider boundary; durable capture-fee journals, recovery and an accounting-backed transfer eligibility check remain the next concrete step. No money moved, flags changed, hosted migration ran or production setup was activated.

Forty focused provider tests passed. All eleven local application test tasks passed, including 513 server tests, after removing a sub-millisecond enqueue/worker-clock race from two transfer tests. Workspace/E2E types, source lint excluding generated reports, boundaries, tooling tests, formatting, documentation checks and packaged API build/health/authentication checks passed. Provider responses were synthetic mocks; no real Stripe request was made.

The user made the repository public. GitHub's latest cancellation annotations identified competing requests in the CI concurrency group; hosted runners now execute again. The restarted baseline run passed quality, tests, infrastructure, security, CodeQL and mobile bundling at the last observation, with browser and native builds still running. CI now lets active main runs finish while newer pushes wait, while superseded PR runs remain cancelable. Intermediate pending revisions may be replaced; release still requires successful checks for the exact release commit. This supersedes the earlier CI-deferral status, not the remaining release requirements.

Capture accounting, bank-payout status, deletion fulfillment, provider/native/Figma acceptance and production setup remain incomplete. See [transfer workflow and capture boundary](72-driver-transfer-workflow.md) and [CI concurrency](08-cicd-and-environments.md#concurrent-ci-runs).

## Durable driver transfer reservations and reconciliation — September 12

Implemented protected staff authorization/list/cancel/recovery APIs, atomic owned earnings reservations, immutable decisions, a transfer worker, actual provider balance journals and fair recovery sweeps. Migrations 0036–0037 add pending liabilities and globally source-scoped provider movement bindings. Unknown outcomes retain funds; cancellation cannot release attempted transfers. Revision fencing prevents older reads from undoing reversals; returned money restores unpaid liability under a review hold. Refund authorization and loss allocation respect transfer reservations. Runtime activation requires financial prerequisites, Connect and an explicit owner-approved charge-model acknowledgement; the flag defaults off.

All eleven local application test tasks passed, including 483 server tests at the integrated checkpoint. The final focused workflow run passed eighteen database tests, including confirmation-audit rollback and refund/transfer coordination. Forty-five focused API/runtime/scheduler tests passed. Workspace/E2E types, source lint excluding generated reports, import boundaries, formatting, documentation checks, schema no-diff verification and packaged API build/health/authentication checks passed. No hosted migration, flag activation, Stripe transfer or production payout occurred. This is local synthetic/mock-provider evidence. Capture-processing-fee reconciliation, driver bank-payout UI/status, provider acceptance, commercial case-resolution/payout policy, actual account-deletion fulfillment, remaining Figma/native journeys and production/device setup still require completion. GitHub billing/CI recovery remains deferred by the user; local development continues without claiming release acceptance. See [driver transfer workflow](72-driver-transfer-workflow.md).

## Driver transfer provider boundary — September 12

Added a server-only Stripe transfer adapter for verified captured-fare funding, Accounts v2 recipient readiness, deterministic operation correlation, bounded same-key retries and read-only lost-response recovery. It validates actual transfer/reversal balance movements and rejects ambiguous, incomplete or mismatched histories. New mutations stop after 23 hours from the persisted first attempt; recovery remains available. Automatic destination/on-behalf-of payment models are rejected to avoid mixing money flows.

Twelve focused mocked-transport tests and all eleven local application test tasks passed, including 467 server tests. Workspace/E2E types, source lint excluding generated reports, import boundaries, formatting, documentation checks and packaged API build/health/authentication checks passed. This checkpoint has no mobile/native changes; no new device acceptance is claimed. No real provider request, hosted migration or runtime activation occurred. The adapter is not yet connected to an endpoint/worker: durable driver reservations, authorization, refund/dispute holds, transfer journals and settlement reconciliation remain the next concrete task. This is not a completed driver payout feature or bank-payout proof. Commercial policy and paid setup remain final handoff decisions; GitHub billing/CI recovery is deferred by the user while local development continues. See [provider boundary and remaining orchestration](71-driver-transfer-provider.md).

## Driver gross, adjustments and net earnings — September 12

The driver dashboard, earnings activity and completed-trip summary now distinguish original gross earnings, approved refund/dispute adjustments, reversals and net earnings. Activity pagination includes adjustments on their recorded UTC dates, including negative net amounts in adjustment-only periods. Gross charts retain their original basis and label. Shared contracts reject inconsistent or partial net totals. New clients opt into `details=adjustments`; older clients retain gross-only response shapes, and new clients label older-server responses as gross with adjustment details unavailable. Transfers are excluded from earnings totals; no bank availability or payout completion is inferred.

All eleven local application test tasks passed, including eighteen earnings-query tests and twenty-one mobile API-client tests. Four focused browser checks passed for driver account/navigation and adjusted earnings at 320/390 pixels; the 320-pixel screenshot was inspected for readable amounts and wrapping. The complete synthetic rider/driver trip passed separately, including earnings after completion. Driver iOS/Android/web exports, workspace/E2E types, source lint excluding generated reports, import boundaries, formatting and packaged API build verification passed. The React review checked component reuse, focus/poll cancellation, account scoping, stable hooks and wrapped amount rows. This is local browser/export evidence, not a fresh native binary or physical-device/provider acceptance.

No hosted migration, payment flag, real provider request or production transfer changed. GitHub CI remains deferred by the user until billing is restored and remains a release requirement. Next: durable driver transfer/settlement and provider reconciliation, actual account-deletion fulfillment, remaining Figma/native journeys and production setup. Approved liability/payout policy and paid setup decisions remain final handoff items. See [loss allocation and driver presentation](70-payment-loss-allocation.md).

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

| Area              | Implemented now                                                                                                                                                            | Evidence and remaining boundary                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rider UI          | Figma-derived Home, route/quote review, matching animation, trip/history, completion, receipts, contextual support, saved places, payment settings and floating navigation | Completion/support journey passed locally; completion inspected on iOS and Android. Full Figma, accessibility and large-text acceptance remains open.                                                                                                                                       |
| Driver UI         | Floating translucent navigation/cards, draggable map sheet, offers/trips, earnings/date filters, profile, vehicle/documents, payout setup, messaging and coverage settings | Native previews and synthetic journeys exercised; this is not a complete physical-device acceptance pass.                                                                                                                                                                                   |
| Authentication    | Auth0 PKCE, refresh/revocation, scoped SecureStore, callback routing, stale-response guards and verified-email recovery UI                                                 | Staging protocol and iOS/Android simulator login/session paths have evidence. Email claim Action and one manual verified-email delivery were checked; in-app resend now has local implementation/tests; hosted resend setup, runtime enforcement and native acceptance remain release work. |
| Messaging         | Assignment-scoped inbox/thread, reports, unread state, durable idempotent sends and authenticated WebSockets                                                               | Dedicated Auth0 staging accounts exchanged messages with retry/read/reconnect checks. Push and permanent deletion are separate unfinished work.                                                                                                                                             |
| Driver location   | Native location-only grants, requested three-second delivery and rider WebSocket invalidations with authorized HTTPS reads                                                 | Local cross-instance and moving-location tests passed. Five-second rider polling is fallback only. Locked-phone, battery, permission and network behavior still needs physical devices.                                                                                                     |
| Matching          | Eligible online drivers, timed offers, concurrency protection, configurable 1–100 mile radius (default 25), plus route-time limit                                          | Radius/retry/race tests passed; field dispatch latency and operating policies remain launch checks.                                                                                                                                                                                         |
| Maps/navigation   | Native Google maps and in-app Navigation SDK, pickup/destination guidance and compact controls                                                                             | Simulator guidance has been displayed. Physical spoken/reroute/background acceptance and optional published cloud style are not established.                                                                                                                                                |
| Payments          | Stripe sandbox adapter, PaymentSheet/CustomerSheet, durable sessions, webhooks, capture/allocation ledger, receipts and earnings                                           | iOS sandbox CustomerSheet save/reopen/remove passed. Full native PaymentSheet/3DS, refunds/disputes, driver transfers and settlement are not complete.                                                                                                                                      |
| Documents/support | Private document intake/upload/scanning/review code, staff authorization, support intake/resolution, account-deletion request intake                                       | Intake is not completed deletion fulfillment, staffed support or proof of every hosted document/provider path.                                                                                                                                                                              |
| Notifications     | Registration/revocation, owned device list, tap authorization, durable delivery/receipt worker and repair when installation proof survives                                 | Real APNs/FCM/Expo delivery remains disabled pending setup and physical-device checks. Lost proof has explicit reset after owned-device cleanup; cross-account support remains separate.                                                                                                    |

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
