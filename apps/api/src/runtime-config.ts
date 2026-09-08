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
  const enabled = env.STRIPE_CONNECT_ONBOARDING_ENABLED;
  if (enabled !== undefined && !['true', 'false'].includes(enabled))
    throw new ConfigurationError(['connect.enabled']);
  let connect: { origin: string } | undefined;
  if (enabled === 'true') {
    const parsedOrigin = z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === 'https:' && url.origin === value;
      })
      .safeParse(env.STRIPE_CONNECT_RETURN_ORIGIN);
    if (!parsedOrigin.success) throw new ConfigurationError(['connect.origin']);
    if (
      payments.mode === 'live' &&
      env.STRIPE_CONNECT_MODEL_APPROVED !== 'recipient-express-platform-responsibility'
    )
      throw new ConfigurationError(['connect.modelApproval']);
    connect = { origin: parsedOrigin.data };
  }
  return {
    ...api,
    payments,
    ...(connect ? { connect } : {}),
    paymentSource: `${payments.accountId}:${payments.mode}`,
  };
}
export type RuntimeConfig = ReturnType<typeof readRuntimeConfig>;
