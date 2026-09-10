import { createDatabase } from '@rove/database';
import {
  PushDelivery,
  S3DocumentStore,
  S3DocumentUploadForms,
  S3DocumentInbox,
  type DriverDocumentTransfers,
  ExpoPushProvider,
  type PushProvider,
  type JobHandler,
  PayoutReconciler,
  PayoutWebhookInbox,
  StripePayoutWebhookVerifier,
  type PayoutWebhookVerifier,
  DriverPayouts,
  StripeDriverPayouts,
  type DriverPayoutProvider,
  GoogleMapsProvider,
  MatchingService,
  SearchExpiry,
  OutboxWorker,
  OutboxDrain,
  PaymentCustomers,
  PaymentReconciler,
  PaymentSessions,
  PaymentWebhookInbox,
  QuoteService,
  RideService,
  StripePaymentProvider,
  type MapsProvider,
  type PaymentProvider,
  type PaymentCustomerProvider,
  type PaymentWebhookVerifier,
} from '@rove/server';
import { createApp } from './app';
import { oidcIdentity, type VerifyIdentity } from './auth';
import { readRuntimeConfig, type RuntimeConfig } from './runtime-config';

interface Resources {
  documentTransfers?: DriverDocumentTransfers;
  pushProvider?: PushProvider;
  database: ReturnType<typeof createDatabase>;
  maps: MapsProvider;
  payments: PaymentProvider & PaymentCustomerProvider & PaymentWebhookVerifier;
  verifyIdentity: VerifyIdentity;
  driverPayoutProvider?: DriverPayoutProvider;
  payoutWebhookVerifier?: PayoutWebhookVerifier;
}
/** Composition shared by HTTP and worker hosts; resource ownership stays with the caller. */
export function composeRuntime(config: RuntimeConfig, resources: Resources) {
  const { database, maps, payments, verifyIdentity } = resources;
  const { pool } = database;
  const customers = new PaymentCustomers(pool, payments, config.paymentSource);
  const reconciliation = new PaymentReconciler(pool, payments, config.paymentSource);
  const matching = new MatchingService(pool, maps);
  const searchExpiry = new SearchExpiry(pool);
  const payoutReconciliation = resources.driverPayoutProvider
    ? new PayoutReconciler(pool, resources.driverPayoutProvider, config.paymentSource)
    : undefined;
  const pushDelivery =
    resources.pushProvider && config.pushProjects
      ? new PushDelivery(pool, resources.pushProvider, config.pushProjects)
      : undefined;
  const handlers: Record<string, JobHandler> = {
    ...reconciliation.handlers(),
    ...(payoutReconciliation ? { 'payout.reconcile': payoutReconciliation.handle } : {}),
    'ride.search_expire': async (job) => {
      await searchExpiry.expire(job.aggregateId);
    },
    // Matching checks current funding; requests never authorize their own payment.
    'ride.requested': async (job) => matching.tick(job.aggregateId),
    'matching.tick': async (job) => matching.tick(job.aggregateId),
  };
  const worker = new OutboxWorker(pool, pushDelivery ? pushDelivery.handlers(handlers) : handlers);
  const app = createApp({
    pool,
    ...(resources.documentTransfers ? { documentTransfers: resources.documentTransfers } : {}),
    ...(resources.payoutWebhookVerifier
      ? {
          payoutWebhooks: new PayoutWebhookInbox(pool, resources.payoutWebhookVerifier, config.paymentSource),
        }
      : {}),
    driverPayouts: new DriverPayouts(pool, config.paymentSource, resources.driverPayoutProvider),
    maps,
    verifyIdentity,
    rides: new RideService(pool),
    quotes: new QuoteService(pool, maps, config.rates, config.serviceArea),
    flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
    allowedOrigins: config.allowedOrigins,
    ...(config.pushProjects ? { pushProjects: config.pushProjects } : {}),
    paymentSessions: new PaymentSessions(pool, payments, config.paymentSource, undefined, customers),
    paymentWebhooks: new PaymentWebhookInbox(pool, payments, config.paymentSource),
  });
  return {
    app,
    worker,
    drain: new OutboxDrain(pool, worker),
    searchExpiry,
    ...(pushDelivery ? { pushDelivery } : {}),
    ...(payoutReconciliation ? { payoutReconciliation } : {}),
    close: database.close,
  };
}
/** Only validated environment configuration can construct the real deployment resources. */
export function createRuntime(env: Record<string, string | undefined>) {
  const config = readRuntimeConfig(env);
  const payments = new StripePaymentProvider({ ...config.payments, live: config.payments.mode === 'live' });
  const maps = new GoogleMapsProvider(config.googleMapsApiKey, config.serviceArea);
  const verifyIdentity = oidcIdentity({
    issuer: config.oidcIssuer,
    audience: config.oidcAudience,
    jwksUrl: config.oidcJwksUrl,
  });
  const database = createDatabase(config.databaseUrl);
  // pg emits idle-client errors outside queries. Keep the process alive; never log driver error details.
  database.pool.on('error', () => console.error('Database connection interrupted.'));
  return composeRuntime(config, {
    ...(config.documentStorage
      ? {
          documentTransfers: {
            forms: new S3DocumentUploadForms(config.documentStorage),
            inbox: new S3DocumentInbox(config.documentStorage),
            quarantine: new S3DocumentStore(config.documentStorage),
          },
        }
      : {}),
    ...(config.pushAccessToken ? { pushProvider: new ExpoPushProvider(config.pushAccessToken) } : {}),
    database,
    maps,
    payments,
    verifyIdentity,
    ...(config.connect
      ? {
          payoutWebhookVerifier: new StripePayoutWebhookVerifier({
            secretKey: config.payments.secretKey,
            webhookSecret: config.connect.webhookSecret,
            live: config.payments.mode === 'live',
          }),
          driverPayoutProvider: new StripeDriverPayouts({
            secretKey: config.payments.secretKey,
            live: config.payments.mode === 'live',
            origin: config.connect.origin,
          }),
        }
      : {}),
  });
}
