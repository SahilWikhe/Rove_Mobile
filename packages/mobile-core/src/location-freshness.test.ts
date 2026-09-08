import { expect, test } from 'vitest';
import { remainingLocationMs } from './location-freshness';
test('network delay consumes the location lease and invalid timing never keeps a marker', () => {
  expect(remainingLocationMs(20000, 15000)).toBe(5000);
  expect(remainingLocationMs(20000, 20000)).toBe(0);
  expect(remainingLocationMs(20000, 90000)).toBe(0);
  expect(remainingLocationMs(90000, 1)).toBe(59999);
  for (const [lease, elapsed] of [
    [NaN, 1],
    [Infinity, 0],
    [1000, Infinity],
    [1000, -1],
    [-10, 0],
  ])
    expect(remainingLocationMs(lease!, elapsed!)).toBe(0);
});
