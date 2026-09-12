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

test('synthetic refunds preserve captured totals, bind retries and cap concurrent refunds', async () => {
  const provider = new LocalPayments();
  const { payment: snapshot } = await provider.create({
    rideId: 'refund-ride',
    attemptId: 'refund-attempt',
    customerId: 'cus_synthetic',
    amountCents: 1000,
  });
  const { intentId, rideId, attemptId, customerId, amountCents } = snapshot;
  const payment = { intentId, rideId, attemptId, customerId, amountCents };
  await expect(provider.refund(payment, 100, 'before-capture')).rejects.toThrow();
  await provider.capture(payment, 1000);
  for (const amount of [0, -1, 0.5, NaN, Infinity, 1001])
    await expect(provider.refund(payment, amount, 'invalid')).rejects.toThrow();
  await expect(provider.refund(payment, 100, ' ')).rejects.toThrow();
  const first = await provider.refund(payment, 400, 'first');
  expect(first).toMatchObject({ status: 'succeeded', amountCents: 400 });
  await expect(provider.refund(payment, 401, 'first')).rejects.toThrow('retry mismatch');
  await expect(provider.refund({ ...payment, rideId: 'outsider' }, 400, 'first')).rejects.toThrow(
    'reference mismatch',
  );
  const results = await Promise.allSettled([
    provider.refund(payment, 600, 'second'),
    provider.refund(payment, 600, 'third'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(await provider.refund(payment, 400, 'first')).toEqual(first);
  await expect(provider.refund(payment, 1, 'overflow')).rejects.toThrow();
  expect((await provider.retrieve(payment)).receivedCents).toBe(1000);
  const otherSnapshot = (
    await provider.create({ rideId, attemptId: 'other-attempt', customerId, amountCents })
  ).payment;
  const other = { ...payment, attemptId: 'other-attempt', intentId: otherSnapshot.intentId };
  await provider.capture(other, 1000);
  await expect(provider.refund(other, 400, 'first')).rejects.toThrow('retry mismatch');
});
