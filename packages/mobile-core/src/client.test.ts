import { expect, test, vi } from 'vitest';
import { ApiClient, type Transport } from './index';
import { z } from 'zod';
test('transport propagates the same mutation key without automatic retries', async () => {
  const fetcher = vi.fn<Transport>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const api = new ApiClient('https://api.example', async () => 'fixture-token', fetcher);
  await api.request('/v1/test', z.object({ ok: z.boolean() }), { method: 'POST', body: {}, key: 'same-operation' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { 'Idempotency-Key': 'same-operation' } });
});
test('rejects insecure remote transport, missing authentication and incompatible data', async () => {
  expect(() => new ApiClient('http://public.example', async () => null)).toThrow();
  await expect(new ApiClient('https://api.example', async () => null).me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  const api = new ApiClient('https://api.example', async () => 'token', async () => new Response('{}'));
  await expect(api.me()).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});
test('network failure does not retry a potentially successful booking', async () => {
  const fetcher = vi.fn(async () => { throw new Error('Connection lost after server commit'); });
  const api = new ApiClient('https://api.example', async () => 'token', fetcher);
  await expect(api.book('quote', 'persisted-key')).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
