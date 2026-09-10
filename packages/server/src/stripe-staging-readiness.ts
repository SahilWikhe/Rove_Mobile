import { z } from 'zod';

const Settings = z.object({
  ROVE_ENVIRONMENT: z.literal('staging'),
  STRIPE_SECRET_KEY: z.string().regex(/^(rk|sk)_test_[a-zA-Z0-9]+$/),
  STRIPE_ACCOUNT_ID: z.string().regex(/^acct_[a-zA-Z0-9]+$/),
  STRIPE_PAYMENT_METHOD_CONFIGURATION: z.string().regex(/^pmc_[a-zA-Z0-9]+$/),
});
export interface StripeReadinessReader {
  account(): Promise<unknown>;
  configuration(id: string): Promise<unknown>;
}

/** Explicit staging file only. This reader cannot create customers, intents or charges. */
export async function inspectStripeStaging(
  env: Record<string, string | undefined>,
  reader: (key: string) => StripeReadinessReader,
) {
  const settings = Settings.safeParse(env);
  if (!settings.success) throw new Error('Invalid Stripe staging settings.');
  const expected = settings.data;
  try {
    const client = reader(expected.STRIPE_SECRET_KEY);
    const account = z.object({ id: z.literal(expected.STRIPE_ACCOUNT_ID) }).parse(await client.account());
    const configuration = z
      .object({
        id: z.literal(expected.STRIPE_PAYMENT_METHOD_CONFIGURATION),
        active: z.literal(true),
        livemode: z.literal(false),
        card: z.object({
          available: z.literal(true),
          display_preference: z.object({ value: z.literal('on') }),
        }),
      })
      .parse(await client.configuration(expected.STRIPE_PAYMENT_METHOD_CONFIGURATION));
    return { accountId: account.id, configurationId: configuration.id };
  } catch {
    // Provider errors and schema diagnostics can contain account data or credentials.
    throw new Error(
      'Stripe staging verification failed. Check account, permissions and payment configuration.',
    );
  }
}
