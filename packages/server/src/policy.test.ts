import { describe, expect, it } from 'vitest';
import { assertNotExpired, assertTransition, capabilities } from './policy';
import { developmentRates, priceRoute } from './pricing';

describe('trip state and expiry', () => {
  it('requires arrival and onboard confirmation before completion', () => {
    expect(() => assertTransition('en_route', 'completed', 'driver')).toThrow();
    expect(() => assertTransition('arrived', 'in_progress', 'rider')).toThrow();
    assertTransition('arrived', 'in_progress', 'driver');
    assertTransition('in_progress', 'completed', 'driver');
  });
  it('prevents ordinary cancellation or rematching with a rider onboard', () => {
    for (const role of ['rider', 'driver', 'staff'] as const) {
      expect(() => assertTransition('in_progress', 'cancelled', role)).toThrow();
      expect(() => assertTransition('in_progress', 'searching', role)).toThrow();
    }
    assertTransition('in_progress', 'interrupted', 'driver');
  });
  it('uses a strict server-clock deadline, including equality and malformed input', () => {
    const now = new Date('2026-09-07T12:00:00Z');
    for (const value of ['bad', '2026-09-07T11:59:59Z', now.toISOString()])
      expect(() => assertNotExpired(value, now)).toThrow();
    assertNotExpired('2026-09-07T12:00:01Z', now);
  });
});
it('enforces all scheduling flag prerequisites', () => {
  for (const scheduling of [false, true])
    for (const weekly of [false, true])
      for (const monthly of [false, true]) {
        const result = capabilities({ scheduling, weekly, monthly }, new Date('2026-09-07T12:00:00Z'));
        expect(result.scheduleWeekly).toBe(scheduling && weekly);
        expect(result.scheduleMonthly).toBe(scheduling && monthly);
        expect(Date.parse(result.expiresAt) - Date.parse(result.evaluatedAt)).toBe(60_000);
      }
});
it('prices with minimums and independent driver compensation', () => {
  expect(priceRoute(0, 0, developmentRates)).toEqual({
    fare: 700,
    driverEarnings: 550,
    rateVersion: 'synthetic-v1',
  });
  expect(priceRoute(5000, 720, developmentRates)).toEqual({
    fare: 1050,
    driverEarnings: 790,
    rateVersion: 'synthetic-v1',
  });
  expect(() => priceRoute(-1, 60, developmentRates)).toThrow();
  expect(() => priceRoute(1000, 60, { ...developmentRates, baseCents: NaN })).toThrow();
});
