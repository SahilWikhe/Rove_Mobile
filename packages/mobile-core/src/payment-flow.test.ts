import { expect, test, vi } from 'vitest';
import {
  isPaymentReturnURL,
  latestPaymentRide,
  submitPayment,
  paymentCallbackScope,
  paymentAvailability,
} from './payment-flow';
function fixture() {
  const session = vi.fn(async () => ({ clientSecret: 'pi_fixture_secret_private' }));
  const initialize = vi.fn(async (_secret: string) => ({}));
  const present = vi.fn(async () => ({}));
  return { session, initialize, present };
}
test('sheet submission uses the session once and reports submission rather than server authorization', async () => {
  const f = fixture();
  expect(await submitPayment(f.session, f, () => true)).toBe('submitted');
  expect(f.session).toHaveBeenCalledTimes(1);
  expect(f.initialize).toHaveBeenCalledWith('pi_fixture_secret_private');
  expect(f.present).toHaveBeenCalledTimes(1);
});
test('dismissing payment sheet leaves the ride request unchanged and does not retry', async () => {
  const f = fixture();
  f.present.mockResolvedValue({ error: { code: 'Canceled' } });
  expect(await submitPayment(f.session, f, () => true)).toBe('cancelled');
  expect(f.session).toHaveBeenCalledTimes(1);
});
test('SDK failures cannot expose payment secrets and initialization failure never presents', async () => {
  const f = fixture();
  f.initialize.mockRejectedValue(new Error('pi_fixture_secret_private'));
  await expect(submitPayment(f.session, f, () => true)).rejects.not.toThrow('secret_private');
  expect(f.present).not.toHaveBeenCalled();
});
test('leaving the account or screen during session loading prevents native presentation', async () => {
  const f = fixture();
  let current = true;
  f.session.mockImplementation(async () => {
    current = false;
    return { clientSecret: 'private' };
  });
  expect(await submitPayment(f.session, f, () => current)).toBe('abandoned');
  expect(f.initialize).not.toHaveBeenCalled();
});
test('leaving during initialization prevents presentation and leaving during confirmation suppresses stale results', async () => {
  const f = fixture();
  let current = true;
  f.initialize.mockImplementation(async () => {
    current = false;
    return {};
  });
  expect(await submitPayment(f.session, f, () => current)).toBe('abandoned');
  expect(f.present).not.toHaveBeenCalled();
  current = true;
  f.initialize.mockResolvedValue({});
  f.present.mockImplementation(async () => {
    current = false;
    return {};
  });
  expect(await submitPayment(f.session, f, () => current)).toBe('abandoned');
});

test.each([
  'rove-rider://payment',
  'rove-rider://payment-methods',
  'rove-rider://payment-methods/?setup_intent=seti_fixture',
  'rove-rider://payment?id=synthetic-ride',
  'rove-rider://payment/?id=synthetic-ride#callback',
])('accepts the registered payment return URL: %s', (url) => {
  expect(isPaymentReturnURL(url)).toBe(true);
});
test.each([
  null,
  '',
  'not a URL',
  '/payment',
  'https://payment',
  'rove-driver://payment',
  'rove-rider://payments',
  'rove-rider://payment-methods/unrelated',
  'https://payment-methods',
  'rove-driver://payment-methods',
  'rove-rider://payment.example.test',
  'rove-rider://payment/unrelated',
  'rove-rider://payment@other',
  'rove-rider://user:password@payment',
  'rove-rider://payment:8080',
  'rove-rider://auth/callback?code=synthetic',
])('ignores unrelated or malformed payment callbacks: %s', (url) => {
  expect(isPaymentReturnURL(url)).toBe(false);
});

test('session failures are sanitized and never initialize the payment sheet', async () => {
  const f = fixture();
  f.session.mockRejectedValue(new Error('pi_fixture_secret_private'));
  await expect(submitPayment(f.session, f, () => true)).rejects.toThrow(
    'Payment could not be confirmed. Check your ride status before trying again.',
  );
  expect(f.initialize).not.toHaveBeenCalled();
  expect(f.present).not.toHaveBeenCalled();
});

test('a rejected session request after leaving the screen is abandoned', async () => {
  const f = fixture();
  let current = true;
  f.session.mockImplementation(async () => {
    current = false;
    throw new Error('late request failure');
  });
  expect(await submitPayment(f.session, f, () => current)).toBe('abandoned');
  expect(f.initialize).not.toHaveBeenCalled();
  expect(f.present).not.toHaveBeenCalled();
});

test('a late payment refresh cannot undo authorization observed by polling', async () => {
  let resolveRefresh!: (value: { id: string; version: number; paymentState: string }) => void;
  const refresh = new Promise<{ id: string; version: number; paymentState: string }>((resolve) => {
    resolveRefresh = resolve;
  });
  let visible = { id: 'ride-one', version: 1, paymentState: 'pending' };
  const pending = refresh.then((updated) => {
    visible = latestPaymentRide(visible, updated);
  });
  visible = latestPaymentRide(visible, { id: 'ride-one', version: 3, paymentState: 'authorized' });
  resolveRefresh({ id: 'ride-one', version: 2, paymentState: 'action_required' });
  await pending;
  expect(visible.paymentState).toBe('authorized');
  expect(visible.version).toBe(3);
});
test('payment refresh accepts a newer state and does not compare versions across rides', () => {
  const previous = { id: 'first', version: 8, paymentState: 'authorized' };
  expect(latestPaymentRide(previous, { ...previous, version: 9, paymentState: 'paid' }).paymentState).toBe(
    'paid',
  );
  const other = { id: 'second', version: 1, paymentState: 'pending' };
  expect(latestPaymentRide(previous, other)).toEqual(other);
  expect(latestPaymentRide(null, other)).toEqual(other);
});

test('checkout forwards the scoped customer session to the native sheet', async () => {
  const f = fixture();
  const customer = { customerId: 'cus_fixture', clientSecret: 'synthetic_customer_secret' };
  const session = async () => ({ clientSecret: 'pi_fixture_secret_private', customer });
  expect(await submitPayment(session, f, () => true)).toBe('submitted');
  expect(f.initialize).toHaveBeenCalledWith('pi_fixture_secret_private', customer);
});

test('closed sheet callbacks cannot fetch fresh customer credentials', async () => {
  const scope = paymentCallbackScope(() => true);
  const operation = vi.fn(async () => 'synthetic_secret');
  scope.close();
  await expect(scope.run(operation)).rejects.toThrow('Payment settings closed.');
  expect(operation).not.toHaveBeenCalled();
});
test.each(['sheet closed', 'account changed'])('pending credentials are withheld when %s', async (reason) => {
  let current = true;
  const scope = paymentCallbackScope(() => current);
  let resolve!: (secret: string) => void;
  const pending = scope.run(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  if (reason === 'sheet closed') scope.close();
  else current = false;
  resolve('synthetic_secret');
  await expect(pending).rejects.toThrow('Payment settings closed.');
});
test('an open current sheet receives its requested credentials', async () => {
  const scope = paymentCallbackScope(() => true);
  await expect(scope.run(async () => 'synthetic_secret')).resolves.toBe('synthetic_secret');
  scope.close();
});

test('payment entry requires the requested ride and a successful read, even with a retained authorization', () => {
  const pending = { id: 'ride-a', state: 'searching' as const, paymentState: 'pending' };
  expect(paymentAvailability(pending, 'ride-a', false)).toBe('ready');
  expect(paymentAvailability(pending, 'ride-b', false)).toBe('unknown');
  expect(paymentAvailability(pending, 'ride-a', true)).toBe('unknown');
  expect(paymentAvailability(null, 'ride-a', false)).toBe('unknown');
  expect(paymentAvailability({ ...pending, paymentState: 'authorized' }, 'ride-a', true)).toBe('unknown');
  expect(paymentAvailability({ ...pending, paymentState: 'authorized' }, 'ride-a', false)).toBe('confirmed');
  expect(paymentAvailability({ ...pending, paymentState: 'action_required' }, 'ride-a', false)).toBe('ready');
  for (const state of ['cancelled', 'completed', 'no_driver_found', 'terminated'] as const) {
    expect(paymentAvailability({ ...pending, state }, 'ride-a', false)).toBe('closed');
  }
});
