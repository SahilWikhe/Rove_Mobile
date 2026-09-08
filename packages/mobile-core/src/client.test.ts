import { expect, test, vi } from 'vitest';
import { ApiClient, type Transport } from './index';
import { z } from 'zod';
test('transport propagates the same mutation key without automatic retries', async () => {
  const fetcher = vi.fn<Transport>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const api = new ApiClient('https://api.example', async () => 'fixture-token', fetcher);
  await api.request('/v1/test', z.object({ ok: z.boolean() }), {
    method: 'POST',
    body: {},
    key: 'same-operation',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { 'Idempotency-Key': 'same-operation' } });
});
test('rejects insecure remote transport, missing authentication and incompatible data', async () => {
  expect(() => new ApiClient('http://public.example', async () => null)).toThrow();
  await expect(new ApiClient('https://api.example', async () => null).me()).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
  });
  const api = new ApiClient(
    'https://api.example',
    async () => 'token',
    async () => new Response('{}'),
  );
  await expect(api.me()).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});
test('network failure does not retry a potentially successful booking', async () => {
  const fetcher = vi.fn(async () => {
    throw new Error('Connection lost after server commit');
  });
  const api = new ApiClient('https://api.example', async () => 'token', fetcher);
  await expect(api.book('quote', 'persisted-key')).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('throttling exposes a bounded Retry-After without retrying the request', async () => {
  for (const [header, expected] of [
    ['20', 20],
    ['999999', 3600],
    ['-1', undefined],
    ['invalid', undefined],
  ] as const) {
    const fetcher = vi.fn<Transport>(
      async () =>
        new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Wait before retrying.' } }), {
          status: 429,
          headers: { 'Retry-After': header },
        }),
    );
    const api = new ApiClient('https://api.example', async () => 'fixture', fetcher);
    await expect(api.offers()).rejects.toMatchObject({ status: 429, retryAfterSeconds: expected });
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
test('live read methods forward cancellation to the underlying transport', async () => {
  for (const method of ['ride', 'rides', 'offers'] as const) {
    let signal: AbortSignal | undefined;
    const fetcher: Transport = async (_url, options) => {
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
    };
    const api = new ApiClient('https://api.example', async () => 'fixture', fetcher);
    const abort = new AbortController();
    const result =
      method === 'ride'
        ? api.ride('fixture', abort.signal)
        : method === 'rides'
          ? api.rides(undefined, abort.signal)
          : api.offers(abort.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' });
    await Promise.resolve();
    abort.abort();
    expect(signal?.aborted).toBe(true);
    await assertion;
  }
});

test('payment sessions use authenticated requests and validate the sensitive response without retrying', async () => {
  const rideId = '00000000-0000-4000-8000-000000000001';
  const fetcher = vi.fn<Transport>(
    async () => new Response(JSON.stringify({ rideId, clientSecret: 'pi_fixture_secret_private' })),
  );
  const api = new ApiClient('https://api.example', async () => 'token', fetcher);
  expect(await api.paymentSession(rideId)).toEqual({ rideId, clientSecret: 'pi_fixture_secret_private' });
  expect(fetcher.mock.calls[0]?.[0]).toBe(`https://api.example/v1/rides/${rideId}/payment-session`);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    method: 'POST',
    body: '{}',
    headers: { Authorization: 'Bearer token' },
  });
  fetcher.mockResolvedValue(new Response(JSON.stringify({ rideId, clientSecret: 'invalid' })));
  await expect(api.paymentSession(rideId)).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('profile updates bind the expected account and saved name without automatic retries', async () => {
  const profile = { id: '09f4e751-09d5-4f04-a47c-f70d621fc54f', name: 'New name', role: 'rider' };
  const fetcher = vi.fn<Transport>(async () => new Response(JSON.stringify(profile)));
  const api = new ApiClient('https://api.example', async () => 'fixture', fetcher);
  expect(await api.updateProfileName(profile.id, 'Old name', '  New name  ')).toEqual(profile);
  expect(fetcher.mock.calls[0]?.[1].method).toBe('PATCH');
  expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({
    expectedProfileId: profile.id,
    expectedName: 'Old name',
    name: 'New name',
  });
  expect(() => api.updateProfileName(profile.id, 'Old name', ' ')).toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});
test('profile conflicts surface to the editor without replaying over newer data', async () => {
  const fetcher = vi.fn<Transport>(
    async () =>
      new Response(JSON.stringify({ error: { code: 'PROFILE_CHANGED', message: 'Reload your profile.' } }), {
        status: 409,
      }),
  );
  const api = new ApiClient('https://api.example', async () => 'fixture', fetcher);
  await expect(
    api.updateProfileName('09f4e751-09d5-4f04-a47c-f70d621fc54f', 'Old', 'New'),
  ).rejects.toMatchObject({ code: 'PROFILE_CHANGED', status: 409 });
  expect(fetcher).toHaveBeenCalledOnce();
});

test('history pagination forwards an opaque cursor and keeps its continuation', async () => {
  const fetcher = vi.fn<Transport>(
    async () => new Response(JSON.stringify({ rides: [], nextCursor: 'next-page' })),
  );
  const api = new ApiClient('https://api.example', async () => 'fixture', fetcher);
  expect(await api.rides('cursor?private&value')).toEqual({ rides: [], nextCursor: 'next-page' });
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.example/v1/rides?before=cursor%3Fprivate%26value');
  expect(fetcher).toHaveBeenCalledOnce();
});

test('quote creation forwards cancellation without retrying or booking a ride', async () => {
  const controller = new AbortController();
  let forwarded: AbortSignal | undefined;
  const transport = vi.fn<Transport>(async (_url, options) => {
    forwarded = options.signal as AbortSignal;
    controller.abort();
    return new Response('{}');
  });
  const api = new ApiClient('https://api.example', async () => 'fixture', transport);
  const place = {
    id: 'fixture',
    label: 'Fixture',
    area: 'Raleigh',
    coordinate: { latitude: 35.8, longitude: -78.6 },
  };
  await api.quote(place, place, 'accessible', controller.signal).catch(() => undefined);
  expect(forwarded?.aborted).toBe(true);
  expect(JSON.parse(transport.mock.calls[0]![1].body as string).service).toBe('accessible');
  expect(transport).toHaveBeenCalledOnce();
  expect(transport.mock.calls[0]?.[0]).toBe('https://api.example/v1/quotes');
});

test('saved place writes send only a slot and expected provider ID without automatic replay', async () => {
  const transport = vi.fn<Transport>(async () => new Response(JSON.stringify({ ok: true })));
  const api = new ApiClient('https://api.example', async () => 'fixture', transport);
  await api.savePlace('home', 'new-id', 'old-id');
  expect(transport.mock.calls[0]?.[0]).toBe('https://api.example/v1/saved-places/home');
  expect(JSON.parse(transport.mock.calls[0]![1].body as string)).toEqual({
    placeId: 'new-id',
    expectedPlaceId: 'old-id',
  });
  await api.removeSavedPlace('home', 'new-id');
  expect(transport.mock.calls[1]?.[1].method).toBe('DELETE');
  expect(JSON.parse(transport.mock.calls[1]![1].body as string)).toEqual({ expectedPlaceId: 'new-id' });
  expect(transport).toHaveBeenCalledTimes(2);
});
