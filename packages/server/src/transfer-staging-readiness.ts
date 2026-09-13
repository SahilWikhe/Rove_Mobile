import { z } from 'zod';
import type { DriverTransferProvider } from './driver-transfer-provider';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-zA-Z0-9]{1,96}$`));
const cents = z.number().int().min(0).max(99_999_999);
const Fixture = z
  .object({
    transferId: id('tr'),
    expectedReversedCents: cents,
    reference: z
      .object({
        operationId: z.uuid(),
        firstAttemptAt: z.iso.datetime(),
        driverId: z.uuid(),
        bindingId: z.uuid(),
        accountId: id('acct'),
        chargeId: id('ch'),
        amountCents: cents.min(1),
        payment: z
          .object({
            intentId: id('pi'),
            rideId: z.uuid(),
            attemptId: z.uuid(),
            customerId: id('cus'),
            amountCents: cents.min(1),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (f) =>
      f.expectedReversedCents <= f.reference.amountCents &&
      f.reference.amountCents <= f.reference.payment.amountCents,
  );
const Settings = z.object({
  ROVE_ENVIRONMENT: z.literal('staging'),
  STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_test_[a-zA-Z0-9]+$/),
  STRIPE_ACCOUNT_ID: id('acct'),
});

/** Observes an existing authorized sandbox transfer; never creates or reverses one. */
export async function inspectTransferStaging(
  env: Record<string, string | undefined>,
  rawFixture: unknown,
  createReader: (config: {
    secretKey: string;
    platformAccountId: string;
    live: false;
  }) => Pick<DriverTransferProvider, 'retrieve' | 'find'>,
) {
  try {
    const settings = Settings.parse(env);
    const fixture = Fixture.parse(rawFixture);
    if (fixture.reference.accountId === settings.STRIPE_ACCOUNT_ID) throw new Error('Recipient mismatch');
    const reader = createReader({
      secretKey: settings.STRIPE_SECRET_KEY,
      platformAccountId: settings.STRIPE_ACCOUNT_ID,
      live: false,
    });
    const direct = await reader.retrieve(fixture.reference, fixture.transferId);
    const recovered = await reader.find(fixture.reference);
    for (const result of [direct, recovered]) {
      if (
        !result ||
        result.id !== fixture.transferId ||
        result.amountCents !== fixture.reference.amountCents ||
        result.reversedCents !== fixture.expectedReversedCents
      )
        throw new Error('Transfer mismatch');
    }
    // Both reads must agree even if the provider changes during this observation interval.
    const movements = (value: typeof direct) =>
      JSON.stringify([...value.movements].sort((a, b) => a.id.localeCompare(b.id)));
    if (direct.created !== recovered!.created || movements(direct) !== movements(recovered!))
      throw new Error('Unstable transfer observation');
    return {
      verified: true as const,
      reversedCents: direct.reversedCents,
      movementCount: direct.movements.length,
    };
  } catch {
    throw new Error(
      'Sandbox transfer verification failed. Check the approved fixture, account, read permissions and expected reversal state.',
    );
  }
}
