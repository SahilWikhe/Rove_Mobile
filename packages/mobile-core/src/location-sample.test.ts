import { expect, test } from 'vitest';
import { newestLocation } from './location-sample';
const now = Date.parse('2026-09-07T12:00:00Z');
const fix = (timestamp: number, accuracy: number | null = 5) => ({ timestamp, coords: { latitude: 35.8, longitude: -78.6, accuracy } });
test('selects the newest accurate fix regardless of delivery order', () => {
  const sample = newestLocation([fix(now), fix(now - 10_000), fix(now + 1000, 500)], now);
  expect(sample?.sampledAt).toBe(new Date(now).toISOString());
});
test('drops old, future, invalid and unknown-accuracy fixes', () => {
  expect(newestLocation([fix(now - 31_000), fix(now + 6000), fix(NaN), fix(now, null), fix(now, -1)], now)).toBeNull();
});
