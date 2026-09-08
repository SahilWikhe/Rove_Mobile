import { defineConfig } from '@playwright/test';
const api = 'http://localhost:4085';
const webEnv = { EXPO_PUBLIC_API_URL: api, EXPO_PUBLIC_SYNTHETIC: 'true', CI: '1', EXPO_NO_TELEMETRY: '1' };
export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  forbidOnly: !!process.env.CI,
  use: { viewport: { width: 390, height: 844 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: 'list',
  webServer: [
    {
      command: 'pnpm --filter @rove/api exec tsx src/local.ts',
      env: { ROVE_E2E: '1' },
      url: api + '/health/live',
      reuseExistingServer: false,
      timeout: 90000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    },
    ...(['rider', 'driver'] as const).map((app, index) => ({
      command: `pnpm --filter @rove/${app} exec expo start --web --port ${8091 + index}`,
      env: webEnv,
      url: `http://localhost:${8091 + index}`,
      reuseExistingServer: false,
      timeout: 180000,
      gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 10000 },
    })),
  ],
});
