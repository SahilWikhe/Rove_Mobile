import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('Vercel forwards mobile APIs, Stripe callbacks and internal recovery to the packaged API', () => {
  const config = JSON.parse(readFileSync(new URL('../apps/api/vercel.json', import.meta.url), 'utf8'));
  for (const source of [
    '/health/:path*',
    '/v1/:path*',
    '/tracking/:path*',
    '/webhooks/:path*',
    '/internal/:path*',
    '/connect/:path*',
  ])
    assert.ok(
      config.rewrites.some((rule) => rule.source === source && rule.destination === '/api/index'),
      source,
    );
});
