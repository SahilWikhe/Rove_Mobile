# Installable staging mobile builds

Each app has its own `eas.json`. Run EAS commands from `apps/rider` or `apps/driver`, not the repository root. These profiles target the existing staging API and Auth0 clients, disable synthetic mode, and bundle JavaScript so installed builds do not need Metro. They do not create cloud builds or publish to stores by themselves.

## One-time setup

1. Sign into the intended Expo account with EAS CLI. Link each app to its own Expo project with `eas init`; preserve the existing application identifiers and URL schemes.
2. In each project's EAS `preview` environment, set `EXPO_PUBLIC_EAS_PROJECT_ID` to that project's UUID. Configure `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY` and `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`. The rider also needs its staging `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` beginning with `pk_test_`. These values are embedded in the app; never put Stripe secret keys, database credentials or server Maps keys here.
3. Restrict each native Maps key to the correct bundle/package identifier. Android restrictions must include the SHA-1 of the actual EAS signing certificate; a local debug certificate does not cover a differently signed build.
4. For physical iOS devices, configure Apple signing and register test devices with `eas device:create`. Simulator builds do not require device registration. Configure Android signing through EAS credentials. Keep signing files out of Git.
5. Configure APNs/FCM push credentials for each app before device notification acceptance testing. Match the Expo project UUIDs to the backend notification project settings.

## Build commands

From the chosen app directory:

```sh
eas build --platform android --profile staging
eas build --platform ios --profile staging
eas build --platform ios --profile staging-simulator
```

The Android staging artifact is an APK. The iOS staging profile is for internal device distribution; `staging-simulator` is for an iOS simulator. These builds use the existing app identifiers and replace another build of the same app on a device. They are not separate side-by-side app variants.

The `eas-build-pre-install` hook checks the selected profile, native platform, exact staging endpoint/auth settings, synthetic flag, Expo project UUID and required public keys. Errors list field names only. The check validates configuration shape and environment selection, not key authorization, signing or service availability.

## Acceptance before distribution

Install and launch with Metro stopped. Verify Auth0 login/callback/logout, Maps rendering, rider payment sheet in Stripe test mode, driver foreground/background location, push notification opening, request/acceptance recovery and full trip completion on both platforms. Check receipt, hold release and earnings against the server. A successful build alone does not prove these flows.

Production profiles and store submission must follow the final production endpoints, Auth0 applications, live payment policy, signing and operating approvals. Do not turn a staging build into production by changing only a Stripe key.

References: [Expo monorepo builds](https://docs.expo.dev/build-reference/build-with-monorepos/), [build profiles](https://docs.expo.dev/build/eas-json/), [internal distribution](https://docs.expo.dev/build/internal-distribution/).
