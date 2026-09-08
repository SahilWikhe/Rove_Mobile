# Local development and synthetic ride testing

The local environment exercises both apps, API, domain services and PostgreSQL together. It deliberately does not make real payments, send notifications or route real customers.

## Requirements

- Node version in `.nvmrc` and pnpm version in root `package.json`.
- `pnpm install` from the repository root.
- The embedded PostgreSQL package initializes a disposable loopback-only database. Its native package build script must be allowed as configured in `pnpm-workspace.yaml`.

## Run locally

Start the API in one terminal:

```sh
pnpm dev:api
```

Start the rider app in another terminal:

```sh
EXPO_PUBLIC_API_URL=http://localhost:4080 EXPO_PUBLIC_SYNTHETIC=true \
  pnpm --filter @rove/rider exec expo start --port 8081 --localhost
```

Start the driver app in a third terminal:

```sh
EXPO_PUBLIC_API_URL=http://localhost:4080 EXPO_PUBLIC_SYNTHETIC=true \
  pnpm --filter @rove/driver exec expo start --port 8082 --localhost
```

Open the local web previews at ports 8081 and 8082. These previews are useful integration checks, not replacements for native device tests. Android emulators use `http://10.0.2.2:4080` for the host API; physical-device networking needs an explicitly configured development connection.

Synthetic mode only activates in development bundles. The local API refuses to start with production mode or a Vercel deployment environment. Production composition must never import `apps/api/src/local.ts` or the test database helper.

## Exercise a ride

1. Choose Get started in each app to load its seeded synthetic identity.
2. Put the driver online. Synthetic mode uses a fixture location without requesting device location.
3. In the rider app, search for Home as pickup and Work as destination.
4. Review the synthetic quote and request the ride.
5. In the driver app, open the offer and accept before its real 20-second deadline.
6. Confirm heading to pickup, arrival, rider onboard/start, and completion.
7. Verify the rider sees the completed ride and synthetic payment result. Verify the driver no longer sees rider identity or exact endpoints after completion.

The local worker applies synthetic authorization and settlement to real database records. The production payment implementation remains separate work; these handlers are not a payment integration.

Each API restart creates a new disposable database and identities. Do not rely on this environment to retain work. Browser preview sessions are in-memory and require sign-in after a reload. Native tokens use secure storage with a separate synthetic storage key.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm docs:check
pnpm --filter @rove/rider --filter @rove/driver --parallel build
```

Database tests intentionally attempt invalid concurrent assignments and invalid monetary values; PostgreSQL constraint errors in their logs are expected when the tests pass. See the implementation ledger for current coverage and remaining release requirements.
