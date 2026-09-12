import { expect, test, vi } from 'vitest';
import { ExpoPushProvider } from './expo-push';
import type { PushMessage } from './push-provider';
const now = new Date('2026-09-08T12:00:00.000Z');
const id = '00000000-0000-4000-8000-000000000001';
const message: PushMessage = {
  token: 'ExpoPushToken[synthetic_token]',
  hint: { kind: 'ride_update', eventId: id, referenceId: id },
  expiresAt: '2026-09-08T12:01:00.000Z',
};
function setup(body: unknown, status = 200) {
  const transport = vi.fn(
    async (_url: string, _options: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
  return { transport, provider: new ExpoPushProvider('synthetic-expo-access', transport, () => now) };
}
test('send emits generic bounded hints to one fixed authenticated endpoint', async () => {
  const { provider, transport } = setup({ data: { status: 'ok', id } });
  expect(await provider.send(message)).toEqual({ status: 'accepted', receiptId: id });
  const [url, options] = transport.mock.calls[0]!;
  expect(url).toBe('https://exp.host/--/api/v2/push/send');
  expect(options.redirect).toBe('error');
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(options.headers).toMatchObject({ Authorization: 'Bearer synthetic-expo-access' });
  expect(JSON.parse(options.body as string)).toEqual({
    to: message.token,
    title: 'Rove',
    body: 'Open Rove to check your latest trip information.',
    data: message.hint,
    ttl: 60,
    priority: 'high',
    sound: 'default',
    channelId: 'default',
    collapseId: id,
    tag: id,
  });
});
test('expired hints are not sent and long expiry or injected private fields are rejected', async () => {
  const { provider, transport } = setup({});
  expect(await provider.send({ ...message, expiresAt: now.toISOString() })).toEqual({ status: 'expired' });
  await expect(provider.send({ ...message, expiresAt: '2026-09-08T12:06:00.000Z' })).rejects.toMatchObject({
    code: 'INVALID_PUSH_EXPIRY',
  });
  await expect(
    provider.send({ ...message, hint: { ...message.hint, address: 'Private' } } as PushMessage),
  ).rejects.toMatchObject({ code: 'INVALID_PUSH_MESSAGE' });
  await expect(provider.send({ ...message, token: 'https://attacker.invalid' })).rejects.toMatchObject({
    code: 'INVALID_PUSH_MESSAGE',
  });
  expect(transport).not.toHaveBeenCalled();
});
test('ticket errors classify invalid token, throttle, configuration and unknown rejection', async () => {
  for (const [error, status] of [
    ['DeviceNotRegistered', 'invalid_token'],
    ['MessageRateExceeded', 'retryable'],
    ['InvalidCredentials', 'configuration'],
    ['MismatchSenderId', 'configuration'],
    ['MessageTooBig', 'rejected'],
    ['FutureProviderError', 'rejected'],
  ]) {
    const { provider } = setup({ data: { status: 'error', message: message.token, details: { error } } });
    expect(await provider.send(message)).toEqual({ status });
  }
});
test('receipt success means gateway acceptance; absent receipt remains pending', async () => {
  const { provider, transport } = setup({ data: { [id]: { status: 'ok' } } });
  expect(await provider.receipt(id)).toEqual({ status: 'accepted_by_gateway' });
  expect(transport.mock.calls[0]?.[0]).toBe('https://exp.host/--/api/v2/push/getReceipts');
  expect(JSON.parse(transport.mock.calls[0]![1].body as string)).toEqual({ ids: [id] });
  expect(await setup({ data: {} }).provider.receipt(id)).toEqual({ status: 'pending' });
  expect(
    await setup({
      data: { [id]: { status: 'error', details: { error: 'DeviceNotRegistered' } } },
    }).provider.receipt(id),
  ).toEqual({ status: 'invalid_token' });
});
test('malformed receipt or batch response cannot be reported as successful', async () => {
  for (const response of [
    {},
    { data: { status: 'ok' } },
    { data: [{ status: 'ok', id }] },
    { data: { status: 'ok', id }, errors: [{}] },
  ])
    await expect(setup(response).provider.send(message)).rejects.toMatchObject({
      code: 'PUSH_SEND_UNCONFIRMED',
    });
  await expect(setup({ data: { [id]: { status: 'unknown' } } }).provider.receipt(id)).rejects.toMatchObject({
    code: 'PUSH_RECEIPT_UNAVAILABLE',
  });
  const { provider, transport } = setup({});
  await expect(provider.receipt('__proto__')).rejects.toMatchObject({ code: 'INVALID_PUSH_RECEIPT' });
  expect(transport).not.toHaveBeenCalled();
});
test('HTTP failures and transport exceptions redact secrets and never automatically resend', async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    const { provider, transport } = setup({ message: message.token }, status);
    await expect(provider.send(message)).rejects.toMatchObject({
      code: status === 429 || status >= 500 ? 'PUSH_PROVIDER_UNAVAILABLE' : 'PUSH_PROVIDER_REJECTED',
    });
    expect(transport).toHaveBeenCalledOnce();
  }
  const transport = vi.fn(async () => {
    throw new Error(message.token + ' synthetic-expo-access');
  });
  const provider = new ExpoPushProvider('synthetic-expo-access', transport, () => now);
  await expect(provider.send(message)).rejects.toMatchObject({
    code: 'PUSH_SEND_UNCONFIRMED',
    message: 'Push provider result could not be confirmed.',
  });
  await expect(provider.receipt(id)).rejects.toMatchObject({ code: 'PUSH_RECEIPT_UNAVAILABLE' });
  expect(() => new ExpoPushProvider('')).toThrow('access token');
  expect(() => new ExpoPushProvider('bad\nheader')).toThrow('access token');
});
test('invalid JSON and oversized response bodies fail closed', async () => {
  for (const body of ['not-json', 'x'.repeat(65_537)]) {
    const provider = new ExpoPushProvider(
      'synthetic',
      async () => new Response(body),
      () => now,
    );
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'PUSH_SEND_UNCONFIRMED' });
  }
});
