import { test, expect } from 'vitest';
import { realtimeDatabaseUrl } from './realtime-config';
const main = 'postgresql://runtime:synthetic@ep-test-pooler.us-east-2.aws.neon.tech/rove?sslmode=verify-full';
const direct = main.replace('-pooler.', '.');
test('realtime accepts only the direct form of the same database and runtime role', () => {
  expect(realtimeDatabaseUrl({ DATABASE_URL: main })).toBeUndefined();
  expect(realtimeDatabaseUrl({ DATABASE_URL: main, REALTIME_DATABASE_URL: direct })).toBe(direct);
  for (const value of [
    main,
    direct.replace('ep-test', 'ep-other'),
    direct.replace('/rove', '/production'),
    direct.replace('runtime', 'owner'),
    direct.replace('verify-full', 'require'),
    direct + '#fragment',
  ]) {
    expect(() => realtimeDatabaseUrl({ DATABASE_URL: main, REALTIME_DATABASE_URL: value })).toThrow(
      'realtime.databaseUrl',
    );
    try {
      realtimeDatabaseUrl({ DATABASE_URL: main, REALTIME_DATABASE_URL: value });
    } catch (error) {
      expect(String(error)).not.toContain('synthetic');
    }
  }
});
