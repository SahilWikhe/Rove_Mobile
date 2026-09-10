import { test as base, expect } from '@playwright/test';

// Tests run serially against one disposable API. Keep a previous test's requests
// from spending the next test's budget; limits remain enforced within each test.
export const test = base.extend<{ isolatedRateCounters: void }>({
  isolatedRateCounters: [
    async ({ request }, use) => {
      const response = await request.post('http://localhost:4085/__e2e/reset-rate-limits');
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ reset: true });
      await use();
    },
    { auto: true },
  ],
});
export { expect };
