# Android native verification

## Current checkpoint

Reviewed September 12, 2026. Android rider/driver Auth0 callback/session acceptance and subsequent synthetic UI previews have been exercised. CI now compiles both debug and standalone release binaries for each role on Android and iOS; it does not run device journeys. The dated evidence below describes earlier builds and their limitations, not a current list of missing UI features. Full physical-device payment, navigation, locked GPS, push and store acceptance remain open. See [current status](18-implementation-status.md).

## Local toolchain

Use a full JDK 21, not the JRE used by Maestro. Install Android command-line tools, platform-tools, platform 36, build-tools 36.0.0, NDK 27.1.12297006 and CMake 3.22.1. These versions come from the installed React Native/Expo native configuration; reassess them when upgrading Expo. The generated Gradle wrapper currently uses 9.3.1. Google's [SDK download page](https://developer.android.com/studio) and [SDK manager documentation](https://developer.android.com/tools/sdkmanager) describe installation.

For Apple Silicon, use an ARM64 Android 36 Google APIs emulator image. The local verification device is `rove_api36`, using a Pixel 7 hardware profile. Tooling is stored outside the repository; never commit SDK downloads, emulators, Gradle caches or signing credentials. The repository ignores Expo-generated `apps/*/android` directories. Native configuration must be encoded in app.json or a config plugin, not only edited in generated files.

Set `JAVA_HOME` to the JDK's `Contents/Home` and `ANDROID_HOME` to the SDK root. Put the JDK bin directory, SDK platform-tools, Node and pnpm on PATH. Generate each app independently from its directory:

```sh
pnpm exec expo prebuild --platform android --no-install
./android/gradlew -p android app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
```

This builds a debug APK for the ARM emulator only; it does not create or verify a Play Store release. Both apps include the Expo-compatible `expo-system-ui` module required by their configured dark user interface style. Prebuild must run again after native dependency/config changes.

## Isolated auth acceptance

Start `pnpm dev:api:auth0` from the repository root. Start separate Metro sessions with the explicit staging Auth0 overrides in [provider setup](62-provider-setup-handoff.md). Use the rider client for rider and driver client for driver. Avoid changing committed or saved production configuration.

For an emulator, `adb reverse tcp:4086 tcp:4086` permits the debug app to use the host's isolated loopback API at `http://127.0.0.1:4086`. Also reverse the chosen Metro port and ensure the native developer settings point to it. In this run, rider used `adb reverse tcp:8081 tcp:8087` with its app-specific debug host set to `127.0.0.1:8081`; driver used `adb reverse tcp:8088 tcp:8088` and `127.0.0.1:8088`. The first rider launch attempted the default host and could not load its script; explicitly configuring the debug host resolved this. These preferences live only in the debug app data, not app.json or release configuration. Reverse mappings are device/session-specific. A real device or deployed app requires its own deliberate networking and HTTPS configuration.

Use only synthetic identities. Verify hosted login, exact app callback, profile creation, app force-stop/relaunch with restored identity, sign-out, and another relaunch remaining signed out. For drivers, assert that an unapproved profile cannot go online. Do not interpret a successful JavaScript export or APK build as evidence that those flows ran. Real GPS, background delivery, notifications and Stripe native payment acceptance are separate requirements.

## Evidence

September 10: installed checksum-verified Android command-line tools and a full Temurin JDK 21.0.12.1, installed the required SDK/compiler packages and booted the dedicated Android 36 emulator (ADB boot-completed value 1). Generated both native projects. Both app typechecks, dependency formatting and import boundaries passed. Both ARM64 debug APKs built successfully: rider in 5m 47s (361 executed tasks), driver in 1m 6s (308 executed, 28 up-to-date). Installed both into the emulator and visually verified their correctly themed welcome screens after configuring Metro. Gradle also installed Build-Tools 35 for a dependency; third-party deprecation and SDK XML warnings did not fail the builds. No Android login, callback, profile, session-persistence, maps, payment or background-location acceptance has been performed yet. iOS must be rebuilt when adopting the new native module; this checkpoint does not claim that rebuild.

## Callback and session acceptance — September 10

The initial Android driver login returned to Expo Router's Unmatched Route screen. Both apps now provide a `+native-intent` hook using the shared `nativeAuthIntent` helper. It redirects only their exact OAuth callback to the home route, stripping response parameters from navigation state. It does not exchange tokens or authenticate a user; the existing AuthSession request still validates state and completes PKCE. Nine unit cases cover both schemes, error callbacks and preservation of unrelated/malformed links. See [Expo native intent guidance](https://docs.expo.dev/router/advanced/native-intent/).

Retesting with separate synthetic identities passed for both apps: hosted login, native callback, name/profile submission, home screen, force-stop/relaunch restoring the session, sign-out, and another relaunch staying signed out. Driver acceptance also asserted the document/payout review message and disabled Go online action. The rider test initially used an incorrect home-text selector, and a screenshot exposed a local transport error during registration. Reinstating ADB forwarding resolved the transport error; retry and the complete session sequence passed. This does not prove native refresh rotation over an expired access token or physical-device behavior.

Port forwarding was observed to be absent between separate Maestro runs. Check `adb reverse --list` and reinstate the API and app-specific Metro mappings before every run and before manual testing. An absent mapping can produce a script-loading or connection-interrupted error even while host services are healthy. Use `/health/live` for the local API health check; `/health` is not a registered endpoint.

All 99 mobile-core tests, relevant typechecks, changed-source lint and module-boundary checks passed. At that checkpoint, broader journeys, native maps/payment, background location, release signing and the iOS rebuild/retest were outstanding. Subsequent native previews and builds supersede the initial build-only status; full physical-device acceptance remains open.

Both temporary Android Auth0 identities were blocked with independent readback after acceptance. Their private fixture files and credential-bearing Maestro run folders were removed. The founder’s manual rider identity was preserved.
