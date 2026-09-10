# Android native verification

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
