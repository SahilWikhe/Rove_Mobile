import { z } from 'zod';
import { ConfigurationError, readApiConfig } from './config';

const Payments = z.object({
  accountId: z.string().regex(/^acct_[a-zA-Z0-9]{1,96}$/),
  mode: z.enum(['test', 'live']),
  secretKey: z.string().regex(/^(sk|rk)_(test|live)_[a-zA-Z0-9]+$/),
  webhookSecret: z.string().regex(/^whsec_[a-zA-Z0-9]+$/),
  paymentMethodConfiguration: z.string().regex(/^pmc_[a-zA-Z0-9]{1,96}$/),
});
/** No real-provider deployment can silently fall back to mock payments or identity. */
export function readRuntimeConfig(env: Record<string, string | undefined>) {
  const api = readApiConfig(env);
  const parsed = Payments.safeParse({
    accountId: env.STRIPE_ACCOUNT_ID,
    mode: env.STRIPE_MODE,
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    paymentMethodConfiguration: env.STRIPE_PAYMENT_METHOD_CONFIGURATION,
  });
  if (!parsed.success)
    throw new ConfigurationError(parsed.error.issues.map((issue) => `payments.${String(issue.path[0])}`));
  const payments = parsed.data;
  if (
    !payments.secretKey.startsWith(`sk_${payments.mode}_`) &&
    !payments.secretKey.startsWith(`rk_${payments.mode}_`)
  )
    throw new ConfigurationError(['payments.mode']);
  if ((api.environment === 'production') !== (payments.mode === 'live'))
    throw new ConfigurationError(['payments.mode']);
  return { ...api, payments, paymentSource: `${payments.accountId}:${payments.mode}` };
}
export type RuntimeConfig = ReturnType<typeof readRuntimeConfig>;
