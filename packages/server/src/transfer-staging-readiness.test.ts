import { expect, test, vi } from 'vitest';
import { inspectTransferStaging } from './transfer-staging-readiness';
const uuid = '11111111-1111-4111-8111-111111111111';
const env = {
  ROVE_ENVIRONMENT: 'staging',
  STRIPE_SECRET_KEY: 'rk_test_fixture',
  STRIPE_ACCOUNT_ID: 'acct_platform',
};
const fixture = {
  transferId: 'tr_test',
  expectedReversedCents: 0,
  reference: {
    operationId: uuid,
    firstAttemptAt: '2026-09-12T00:00:00.000Z',
    driverId: uuid,
    bindingId: uuid,
    accountId: 'acct_recipient',
    chargeId: 'ch_test',
    amountCents: 800,
    payment: {
      intentId: 'pi_test',
      rideId: uuid,
      attemptId: uuid,
      customerId: 'cus_test',
      amountCents: 1000,
    },
  },
};
const snapshot = {
  id: 'tr_test',
  created: 1789171200,
  amountCents: 800,
  reversedCents: 0,
  movements: [
    {
      id: 'txn_test',
      sourceId: 'tr_test',
      kind: 'transfer' as const,
      amountCents: -800,
      feeCents: 0,
      netCents: -800,
    },
  ],
};
test('rejects live mode, ambient/absent settings and malformed fixtures before constructing a provider', async () => {
  const factory = vi.fn();
  for (const settings of [
    {},
    { ...env, ROVE_ENVIRONMENT: 'production' },
    { ...env, STRIPE_SECRET_KEY: 'sk_live_fixture' },
  ]) {
    await expect(inspectTransferStaging(settings, fixture, factory)).rejects.toThrow(
      'Sandbox transfer verification failed',
    );
  }
  for (const invalid of [
    { ...fixture, extra: true },
    { ...fixture, expectedReversedCents: 801 },
    { ...fixture, reference: { ...fixture.reference, accountId: 'acct_platform' } },
  ]) {
    await expect(inspectTransferStaging(env, invalid, factory)).rejects.toThrow();
  }
  expect(factory).not.toHaveBeenCalled();
});
test('verifies direct retrieval and lost-response recovery identify the same transfer', async () => {
  const retrieve = vi.fn().mockResolvedValue(snapshot),
    find = vi.fn().mockResolvedValue(snapshot);
  await expect(inspectTransferStaging(env, fixture, () => ({ retrieve, find }))).resolves.toEqual({
    verified: true,
    reversedCents: 0,
    movementCount: 1,
  });
  expect(retrieve).toHaveBeenCalledWith(fixture.reference, fixture.transferId);
  expect(find).toHaveBeenCalledWith(fixture.reference);
});
test('rejects missing recovery, wrong transfer, unexpected reversal and changing movements', async () => {
  for (const recovered of [
    null,
    { ...snapshot, id: 'tr_other' },
    { ...snapshot, reversedCents: 1 },
    { ...snapshot, movements: [] },
  ]) {
    await expect(
      inspectTransferStaging(env, fixture, () => ({
        retrieve: vi.fn().mockResolvedValue(snapshot),
        find: vi.fn().mockResolvedValue(recovered),
      })),
    ).rejects.toThrow();
  }
});
test('accepts a verified reversal while allowing provider movement ordering differences', async () => {
  const reversed = {
    ...snapshot,
    reversedCents: 800,
    movements: [
      ...snapshot.movements,
      {
        id: 'txn_reversal',
        sourceId: 'trr_test',
        kind: 'transfer_refund' as const,
        amountCents: 800,
        feeCents: 0,
        netCents: 800,
      },
    ],
  };
  await expect(
    inspectTransferStaging(env, { ...fixture, expectedReversedCents: 800 }, () => ({
      retrieve: vi.fn().mockResolvedValue(reversed),
      find: vi.fn().mockResolvedValue({ ...reversed, movements: [...reversed.movements].reverse() }),
    })),
  ).resolves.toMatchObject({ verified: true, reversedCents: 800, movementCount: 2 });
});
test('does not expose provider errors or credentials', async () => {
  await expect(
    inspectTransferStaging(env, fixture, () => ({
      retrieve: vi.fn().mockRejectedValue(new Error('rk_test_secret raw provider payload')),
      find: vi.fn(),
    })),
  ).rejects.toThrow(/^Sandbox transfer verification failed\./);
});
