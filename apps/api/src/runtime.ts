import { createDatabase } from '@rove/database';
import {
  GoogleMapsProvider,
  MatchingService,
  SearchExpiry,
  OutboxWorker,
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
  database: ReturnType<typeof createDatabase>;
  maps: MapsProvider;
  payments: PaymentProvider & PaymentCustomerProvider & PaymentWebhookVerifier;
  verifyIdentity: VerifyIdentity;
}
/** Composition shared by HTTP and worker hosts; resource ownership stays with the caller. */
export function composeRuntime(config: RuntimeConfig, resources: Resources) {
  const { database, maps, payments, verifyIdentity } = resources;
  const { pool } = database;
  const customers = new PaymentCustomers(pool, payments, config.paymentSource);
  const reconciliation = new PaymentReconciler(pool, payments, config.paymentSource);
  const matching = new MatchingService(pool, maps);
  const searchExpiry = new SearchExpiry(pool);
  const worker = new OutboxWorker(pool, {
    ...reconciliation.handlers(),
    'ride.search_expire': async (job) => {
      await searchExpiry.expire(job.aggregateId);
    },
    // Matching checks current funding; requests never authorize their own payment.
    'ride.requested': async (job) => matching.tick(job.aggregateId),
    'matching.tick': async (job) => matching.tick(job.aggregateId),
    // Notification/review events remain durable dead letters until their real consumers are added.
    // Never acknowledge these as delivered using an empty handler.
  });
  const app = createApp({
    pool,
    maps,
    verifyIdentity,
    rides: new RideService(pool),
    quotes: new QuoteService(pool, maps, config.rates, config.serviceArea),
    flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
    allowedOrigins: config.allowedOrigins,
    paymentSessions: new PaymentSessions(pool, payments, config.paymentSource, undefined, customers),
    paymentWebhooks: new PaymentWebhookInbox(pool, payments, config.paymentSource),
  });
  return { app, worker, searchExpiry, close: database.close };
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
  return composeRuntime(config, { database, maps, payments, verifyIdentity });
}
