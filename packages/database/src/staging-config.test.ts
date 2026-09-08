import { expect, test } from 'vitest';
import { stagingUrl } from './staging-config';
const env = {
  ROVE_ENVIRONMENT: 'staging',
  NEON_STAGING_HOST: 'ep-fixture.us-east-2.aws.neon.tech',
  DATABASE_URL:
    'postgresql://app:fixture@ep-fixture-pooler.us-east-2.aws.neon.tech/neondb?sslmode=verify-full',
  DATABASE_URL_UNPOOLED:
    'postgresql://owner:fixture@ep-fixture.us-east-2.aws.neon.tech/neondb?sslmode=verify-full',
};
test('staging operations require explicit environment and exact direct/pooled endpoint', () => {
  expect(stagingUrl(env, true)).toBe(env.DATABASE_URL);
  expect(stagingUrl(env, false)).toBe(env.DATABASE_URL_UNPOOLED);
  for (const changes of [
    { ROVE_ENVIRONMENT: 'production' },
    { VERCEL: '1' },
    { NODE_ENV: 'production' },
    { NEON_STAGING_HOST: '' },
    { NEON_STAGING_HOST: 'ep-production.us-east-2.aws.neon.tech' },
    { DATABASE_URL_UNPOOLED: env.DATABASE_URL },
    { DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED.replace('verify-full', 'require') },
    { DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED + '&sslmode=disable' },
    { DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED.replace('/neondb', '/other') },
  ])
    expect(() => stagingUrl({ ...env, ...changes }, false)).toThrow('Staging requires');
});
test('invalid credential input is never echoed in errors', () => {
  expect(() => stagingUrl({ ...env, DATABASE_URL_UNPOOLED: 'PRIVATE_SECRET' }, false)).toThrow(
    /^Staging requires a confirmed Neon endpoint and verify-full credentials\.$/,
  );
});
