import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCandidateHealth } from './production-candidate-health.mjs';
test('candidate probe uses bounded nonredirecting HTTPS and optional protection bypass', async () => {
  await checkCandidateHealth('https://candidate.vercel.app', 'synthetic', async (url, options) => {
    assert.equal(url, 'https://candidate.vercel.app/health/ready');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-vercel-protection-bypass'], 'synthetic');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ status: 'ready' });
  });
  for (const response of [
    Response.json({ status: 'bad' }),
    Response.json({ status: 'ready' }, { status: 503 }),
    new Response('Sign in'),
  ])
    await assert.rejects(
      checkCandidateHealth('https://candidate.vercel.app', undefined, async () => response),
    );
  for (const url of [
    'https://example.com',
    'http://candidate.vercel.app',
    'https://candidate.vercel.app@evil.test',
    'https://candidate.vercel.app/path',
  ])
    await assert.rejects(
      checkCandidateHealth(url, 'synthetic', () => assert.fail('must not request invalid URL')),
    );
});
