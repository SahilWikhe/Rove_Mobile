import { expect, test, vi } from 'vitest';
import { LocalPayments } from './local-payments';
test('synthetic payment creation, capture and cancellation are repeatable and reference-bound', async () => {
  const provider = new LocalPayments();
  const reference = {
    rideId: 'synthetic-ride',
    attemptId: 'synthetic-attempt',
    customerId: 'cus_synthetic',
    amountCents: 1185,
  };
  const first = await provider.create(reference);
  expect(await provider.create(reference)).toEqual(first);
  expect(first.payment.status).toBe('requires_capture');
  const { intentId } = first.payment;
  const full = { ...reference, intentId };
  await expect(provider.retrieve({ ...full, rideId: 'different' })).rejects.toThrow('reference mismatch');
  await expect(provider.capture(full, 100)).rejects.toThrow();
  expect((await provider.capture(full, 1185)).receivedCents).toBe(1185);
  expect((await provider.capture(full, 1185)).receivedCents).toBe(1185);
  await expect(provider.cancel(full)).rejects.toThrow();
  const second = await provider.create({ ...reference, attemptId: 'second' });
  const secondReference = { ...reference, attemptId: 'second', intentId: second.payment.intentId };
  expect((await provider.cancel(secondReference)).status).toBe('canceled');
  expect((await provider.cancel(secondReference)).status).toBe('canceled');
  await expect(provider.capture(secondReference, 1185)).rejects.toThrow();
});
test('synthetic provider refuses deployed environments', () => {
  vi.stubEnv('NODE_ENV', 'production');
  try {
    expect(() => new LocalPayments()).toThrow('cannot run in a deployment');
  } finally {
    vi.unstubAllEnvs();
  }
});
