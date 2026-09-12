import { readVerificationEmailConfig } from './verification-email';
import { realtimeDatabaseUrl } from './realtime-config';
import { S3DocumentConfig, GuardDutyScanConfig } from '@rove/server';
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
function readPaymentConfig(env: Record<string, string | undefined>) {
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
  if ((env.ROVE_ENVIRONMENT === 'production') !== (payments.mode === 'live'))
    throw new ConfigurationError(['payments.mode']);
  return payments;
}
function readConnectConfig(env: Record<string, string | undefined>) {
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
      env.STRIPE_MODE === 'live' &&
      env.STRIPE_CONNECT_MODEL_APPROVED !== 'recipient-express-platform-responsibility'
    )
      throw new ConfigurationError(['connect.modelApproval']);
    const webhook = z
      .string()
      .regex(/^whsec_[a-zA-Z0-9]+$/)
      .safeParse(env.STRIPE_CONNECT_WEBHOOK_SECRET);
    if (!webhook.success) throw new ConfigurationError(['connect.webhookSecret']);
    if (webhook.data === env.STRIPE_WEBHOOK_SECRET) throw new ConfigurationError(['connect.webhookSecret']);
    connect = { origin: parsedOrigin.data, webhookSecret: webhook.data };
  }
  return connect;
}
function readPushConfig(env: Record<string, string | undefined>) {
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
  return { ...(pushProjects ? { pushProjects } : {}), ...(pushAccessToken ? { pushAccessToken } : {}) };
}
function readDocumentStorage(env: Record<string, string | undefined>) {
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
  return documentStorage;
}
function readDocumentScanning(env: Record<string, string | undefined>) {
  let documentScanning: z.infer<typeof GuardDutyScanConfig> | undefined;
  if (
    env.DOCUMENT_SCANNING_ENABLED !== undefined &&
    !['true', 'false'].includes(env.DOCUMENT_SCANNING_ENABLED)
  )
    throw new ConfigurationError(['documents.scanning']);
  if (env.DOCUMENT_SCANNING_ENABLED === 'true') {
    const scanning = GuardDutyScanConfig.safeParse({
      bucket: env.DOCUMENT_S3_BUCKET,
      region: env.DOCUMENT_S3_REGION,
      ownerAccountId: env.DOCUMENT_S3_OWNER_ACCOUNT_ID,
      scannerRoleArn: env.DOCUMENT_GUARDDUTY_ROLE_ARN,
    });
    if (!scanning.success) throw new ConfigurationError(['documents.scanning']);
    documentScanning = scanning.data;
  }
  return documentScanning;
}
function readDocumentRole(env: Record<string, string | undefined>) {
  if (env.DOCUMENT_UPLOADS_ENABLED !== 'true' && env.DOCUMENT_SCANNING_ENABLED !== 'true') return undefined;
  if (!env.DOCUMENT_AWS_ROLE_ARN && env.VERCEL !== '1') return undefined;
  const role = z
    .string()
    .regex(/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/)
    .safeParse(env.DOCUMENT_AWS_ROLE_ARN);
  if (!role.success || role.data.split(':')[4] !== env.DOCUMENT_S3_OWNER_ACCOUNT_ID)
    throw new ConfigurationError(['documents.awsRole']);
  return role.data;
}
/** Evaluate independent integrations even when another configuration section is invalid. */
export function readRuntimeConfig(env: Record<string, string | undefined>) {
  const problems: string[] = [];
  function capture<T>(read: () => T): T | undefined {
    try {
      return read();
    } catch (error) {
      if (!(error instanceof ConfigurationError)) throw error;
      problems.push(...error.fields);
      return undefined;
    }
  }
  capture(() => realtimeDatabaseUrl(env));
  const api = capture(() => readApiConfig(env));
  const refundsEnabled = capture(() => {
    if (env.PAYMENT_REFUNDS_ENABLED !== undefined && !['true', 'false'].includes(env.PAYMENT_REFUNDS_ENABLED))
      throw new ConfigurationError(['payments.refundsEnabled']);
    return env.PAYMENT_REFUNDS_ENABLED === 'true';
  });
  const refundOperationsEnabled = capture(() => {
    if (
      env.PAYMENT_REFUND_OPERATIONS_ENABLED !== undefined &&
      !['true', 'false'].includes(env.PAYMENT_REFUND_OPERATIONS_ENABLED)
    )
      throw new ConfigurationError(['payments.refundOperationsEnabled']);
    if (env.PAYMENT_REFUND_OPERATIONS_ENABLED === 'true' && !refundsEnabled)
      throw new ConfigurationError(['payments.refundOperationsEnabled']);
    return env.PAYMENT_REFUND_OPERATIONS_ENABLED === 'true';
  });
  const refundAccountingEnabled = capture(() => {
    if (
      env.PAYMENT_REFUND_ACCOUNTING_ENABLED !== undefined &&
      !['true', 'false'].includes(env.PAYMENT_REFUND_ACCOUNTING_ENABLED)
    )
      throw new ConfigurationError(['payments.refundAccountingEnabled']);
    if (env.PAYMENT_REFUND_ACCOUNTING_ENABLED === 'true' && !refundsEnabled)
      throw new ConfigurationError(['payments.refundAccountingEnabled']);
    return env.PAYMENT_REFUND_ACCOUNTING_ENABLED === 'true';
  });
  const disputesEnabled = capture(() => {
    if (
      env.PAYMENT_DISPUTES_ENABLED !== undefined &&
      !['true', 'false'].includes(env.PAYMENT_DISPUTES_ENABLED)
    )
      throw new ConfigurationError(['payments.disputesEnabled']);
    return env.PAYMENT_DISPUTES_ENABLED === 'true';
  });
  const lossAllocationEnabled = capture(() => {
    if (
      env.PAYMENT_LOSS_ALLOCATION_ENABLED !== undefined &&
      !['true', 'false'].includes(env.PAYMENT_LOSS_ALLOCATION_ENABLED)
    )
      throw new ConfigurationError(['payments.lossAllocationEnabled']);
    if (env.PAYMENT_LOSS_ALLOCATION_ENABLED === 'true' && (!refundAccountingEnabled || !disputesEnabled))
      throw new ConfigurationError(['payments.lossAllocationEnabled']);
    return env.PAYMENT_LOSS_ALLOCATION_ENABLED === 'true';
  });
  const payments = capture(() => readPaymentConfig(env));
  const connect = capture(() => readConnectConfig(env));
  const push = capture(() => readPushConfig(env));
  const documentAwsRoleArn = capture(() => readDocumentRole(env));
  const documentStorage = capture(() => readDocumentStorage(env));
  const documentScanning = capture(() => readDocumentScanning(env));
  const verificationEmail = capture(() => readVerificationEmailConfig(env));
  if (problems.length || !api || !payments) throw new ConfigurationError([...new Set(problems)]);
  return {
    ...(verificationEmail ? { verificationEmail } : {}),
    ...api,
    ...(documentAwsRoleArn ? { documentAwsRoleArn } : {}),
    ...push,
    payments,
    ...(lossAllocationEnabled ? { lossAllocationEnabled: true as const } : {}),
    ...(refundOperationsEnabled ? { refundOperationsEnabled: true as const } : {}),
    ...(refundAccountingEnabled ? { refundAccountingEnabled: true as const } : {}),
    ...(disputesEnabled ? { disputesEnabled: true as const } : {}),
    ...(refundsEnabled ? { refundsEnabled: true as const } : {}),
    ...(documentScanning ? { documentScanning } : {}),
    ...(documentStorage ? { documentStorage } : {}),
    ...(connect ? { connect } : {}),
    paymentSource: `${payments.accountId}:${payments.mode}`,
  };
}
export type RuntimeConfig = ReturnType<typeof readRuntimeConfig>;
