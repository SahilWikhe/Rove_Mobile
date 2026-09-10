import { expect, test, vi } from 'vitest';
import { isPaymentReturnURL, submitPayment } from './payment-flow';
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
  'rove-rider://payment.example.test',
  'rove-rider://payment/unrelated',
  'rove-rider://payment@other',
  'rove-rider://user:password@payment',
  'rove-rider://payment:8080',
  'rove-rider://auth/callback?code=synthetic',
])('ignores unrelated or malformed payment callbacks: %s', (url) => {
  expect(isPaymentReturnURL(url)).toBe(false);
});
