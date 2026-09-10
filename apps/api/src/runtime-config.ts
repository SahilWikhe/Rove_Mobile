import { S3DocumentConfig } from '@rove/server';
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
  let connect: { origin: string; webhookSecret: string } | undefined;
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
    const webhook = z
      .string()
      .regex(/^whsec_[a-zA-Z0-9]+$/)
      .safeParse(env.STRIPE_CONNECT_WEBHOOK_SECRET);
    if (!webhook.success) throw new ConfigurationError(['connect.webhookSecret']);
    if (webhook.data === payments.webhookSecret) throw new ConfigurationError(['connect.webhookSecret']);
    connect = { origin: parsedOrigin.data, webhookSecret: webhook.data };
  }
  let pushProjects: { rider: string; driver: string } | undefined;
  if (env.EXPO_RIDER_PROJECT_ID !== undefined || env.EXPO_DRIVER_PROJECT_ID !== undefined) {
    const projects = z.object({ rider: z.uuid(), driver: z.uuid() }).safeParse({
      rider: env.EXPO_RIDER_PROJECT_ID,
      driver: env.EXPO_DRIVER_PROJECT_ID,
    });
    if (!projects.success || projects.data.rider === projects.data.driver)
      throw new ConfigurationError(['push.projects']);
    pushProjects = projects.data;
  }
  let pushAccessToken: string | undefined;
  if (
    env.EXPO_PUSH_DELIVERY_ENABLED !== undefined &&
    !['true', 'false'].includes(env.EXPO_PUSH_DELIVERY_ENABLED)
  )
    throw new ConfigurationError(['push.enabled']);
  if (env.EXPO_PUSH_DELIVERY_ENABLED === 'true') {
    const token = z
      .string()
      .regex(/^[\x21-\x7e]{1,4096}$/)
      .safeParse(env.EXPO_PUSH_ACCESS_TOKEN);
    if (!pushProjects || !token.success) throw new ConfigurationError(['push.delivery']);
    pushAccessToken = token.data;
  }
  let documentStorage: z.infer<typeof S3DocumentConfig> | undefined;
  const documentEnabled = env.DOCUMENT_UPLOADS_ENABLED;
  if (documentEnabled !== undefined && !['true', 'false'].includes(documentEnabled))
    throw new ConfigurationError(['documents.enabled']);
  if (documentEnabled === 'true') {
    const storage = S3DocumentConfig.safeParse({
      bucket: env.DOCUMENT_S3_BUCKET,
      region: env.DOCUMENT_S3_REGION,
      ownerAccountId: env.DOCUMENT_S3_OWNER_ACCOUNT_ID,
    });
    if (!storage.success) throw new ConfigurationError(['documents.storage']);
    documentStorage = storage.data;
  }
  return {
    ...(documentStorage ? { documentStorage } : {}),
    ...(pushAccessToken ? { pushAccessToken } : {}),
    ...(pushProjects ? { pushProjects } : {}),
    ...api,
    payments,
    ...(connect ? { connect } : {}),
    paymentSource: `${payments.accountId}:${payments.mode}`,
  };
}
export type RuntimeConfig = ReturnType<typeof readRuntimeConfig>;
