import {
  DocumentCleanup,
  type DocumentCleanupProvider,
  S3DocumentInventory,
  S3DocumentErasure,
} from '@rove/server';
import { AccountClosures, type IdentityDeletionProvider } from '@rove/server';
import { Auth0IdentityDeletion } from './identity-deletion';
import { WalletSessions, StripeWalletProvider, type WalletProvider } from '@rove/server';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';
import { createDatabase } from '@rove/database';
import {
  PushDelivery,
  DocumentScanWorker,
  GuardDutyDocumentScanner,
  type DocumentScanner,
  S3DocumentStore,
  S3DocumentDownloads,
  type DocumentDownloads,
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
  BankPayouts,
  StripeBankPayouts,
  type BankPayoutProvider,
  StripeDriverPayouts,
  type DriverPayoutProvider,
  GoogleMapsProvider,
  MatchingService,
  SearchExpiry,
  OutboxWorker,
  OutboxDrain,
  PaymentCustomers,
  PaymentReconciler,
  DisputeReconciler,
  type DisputeProvider,
  RefundOperations,
  PaymentLosses,
  DriverTransfers,
  CaptureFees,
  StripeCaptureBalances,
  type CaptureBalanceProvider,
  StripeDriverTransfers,
  type DriverTransferProvider,
  RefundReconciler,
  type RefundProvider,
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
import { Auth0VerificationEmail } from './verification-email';
import { oidcIdentity, type VerifyIdentity } from './auth';
import { readRuntimeConfig, type RuntimeConfig } from './runtime-config';

interface Resources {
  documentCleanup?: DocumentCleanupProvider & { close?(): void };
  identityDeletion?: IdentityDeletionProvider;
  verificationEmail?: { verifyIdentity: VerifyIdentity; request(subject: string): Promise<void> };
  refundProvider?: RefundProvider;
  disputeProvider?: DisputeProvider;
  wallet?: WalletProvider;
  documentScanner?: DocumentScanner;
  documentTransfers?: DriverDocumentTransfers;
  documentDownloads?: DocumentDownloads;
  pushProvider?: PushProvider;
  database: ReturnType<typeof createDatabase>;
  maps: MapsProvider;
  payments: PaymentProvider & PaymentCustomerProvider & PaymentWebhookVerifier;
  verifyIdentity: VerifyIdentity;
  bankPayoutProvider?: BankPayoutProvider;
  driverPayoutProvider?: DriverPayoutProvider;
  captureBalanceProvider?: CaptureBalanceProvider;
  driverTransferProvider?: DriverTransferProvider;
  payoutWebhookVerifier?: PayoutWebhookVerifier;
}
/** Composition shared by HTTP and worker hosts; resource ownership stays with the caller. */
export function composeRuntime(config: RuntimeConfig, resources: Resources) {
  const { database, maps, payments, verifyIdentity } = resources;
  const { pool } = database;
  if (config.bankPayoutsEnabled && !resources.bankPayoutProvider)
    throw new Error('Bank payout provider is required.');
  if (config.accountClosure && !resources.identityDeletion)
    throw new Error('Identity deletion provider is required.');
  if (config.documentCleanup && !resources.documentCleanup)
    throw new Error('Document cleanup provider is required.');
  const documentCleanup = config.documentCleanup
    ? new DocumentCleanup(pool, resources.documentCleanup!, config.documentCleanup.policyReference)
    : undefined;
  const accountClosures = config.accountClosure
    ? new AccountClosures(pool, resources.identityDeletion!, config.accountClosure.policyReference)
    : undefined;
  const customers = new PaymentCustomers(pool, payments, config.paymentSource);
  const reconciliation = new PaymentReconciler(
    pool,
    payments,
    config.paymentSource,
    undefined,
    !!config.captureAccountingEnabled,
  );
  if (config.captureAccountingEnabled && !resources.captureBalanceProvider)
    throw new Error('Capture balance provider is required.');
  const captureFees = config.captureAccountingEnabled
    ? new CaptureFees(pool, resources.captureBalanceProvider!, config.paymentSource)
    : undefined;
  if (config.refundsEnabled && !resources.refundProvider)
    throw new Error('Refund reconciliation provider is required.');
  const refundReconciliation = config.refundsEnabled
    ? new RefundReconciler(
        pool,
        resources.refundProvider!,
        config.paymentSource,
        undefined,
        config.refundAccountingEnabled,
      )
    : undefined;
  if (config.disputesEnabled && !resources.disputeProvider) throw new Error('Dispute provider is required.');
  const disputeReconciliation = config.disputesEnabled
    ? new DisputeReconciler(pool, resources.disputeProvider!, config.paymentSource)
    : undefined;
  const refundOperations =
    config.refundOperationsEnabled && refundReconciliation
      ? new RefundOperations(
          pool,
          payments,
          refundReconciliation,
          config.paymentSource,
          undefined,
          disputeReconciliation,
        )
      : undefined;
  if (
    config.driverTransfersEnabled &&
    (!captureFees ||
      !resources.driverTransferProvider ||
      !resources.driverPayoutProvider ||
      !refundReconciliation ||
      !disputeReconciliation)
  )
    throw new Error('Transfer provider and financial reconciliation are required.');
  const driverTransfers = config.driverTransfersEnabled
    ? new DriverTransfers(
        pool,
        resources.driverTransferProvider!,
        refundReconciliation!,
        disputeReconciliation!,
        config.paymentSource,
        captureFees!,
      )
    : undefined;
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
    ...(documentCleanup ? { 'document.version-delete': documentCleanup.handle } : {}),
    ...(accountClosures ? { 'account.identity-delete': accountClosures.handle } : {}),
    // Foreground messaging works without a push provider; configured delivery wraps this handler.
    ...(captureFees ? { 'capture-fee.reconcile': captureFees.handle } : {}),
    ...(driverTransfers ? { 'transfer.execute': driverTransfers.handle } : {}),
    ...(refundOperations ? { 'refund.execute': refundOperations.handle } : {}),
    ...(disputeReconciliation ? { 'dispute.reconcile': disputeReconciliation.handle } : {}),
    'message.created': async () => {},
    ...reconciliation.handlers(),
    ...(refundReconciliation ? { 'refund.reconcile': refundReconciliation.handle } : {}),
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
    ...(documentCleanup ? { documentCleanup } : {}),
    ...(accountClosures ? { accountClosures } : {}),
    ...(driverTransfers ? { driverTransfers } : {}),
    ...(refundOperations ? { refundOperations } : {}),
    ...(config.lossAllocationEnabled ? { paymentLosses: new PaymentLosses(pool, config.paymentSource) } : {}),
    ...(disputeReconciliation ? { disputes: disputeReconciliation } : {}),
    ...(refundReconciliation ? { refundsEnabled: true } : {}),
    ...(resources.verificationEmail ? { verificationEmail: resources.verificationEmail } : {}),
    ...(resources.documentDownloads ? { documentDownloads: resources.documentDownloads } : {}),
    ...(resources.documentTransfers ? { documentTransfers: resources.documentTransfers } : {}),
    ...(resources.payoutWebhookVerifier
      ? {
          payoutWebhooks: new PayoutWebhookInbox(pool, resources.payoutWebhookVerifier, config.paymentSource),
        }
      : {}),
    bankPayouts: new BankPayouts(
      pool,
      config.paymentSource,
      config.bankPayoutsEnabled ? resources.bankPayoutProvider : undefined,
    ),
    driverPayouts: new DriverPayouts(pool, config.paymentSource, resources.driverPayoutProvider),
    maps,
    verifyIdentity,
    rides: new RideService(pool),
    quotes: new QuoteService(pool, maps, config.rates, config.serviceArea),
    flags: async () => ({ scheduling: false, weekly: false, monthly: false }),
    allowedOrigins: config.allowedOrigins,
    ...(config.pushProjects ? { pushProjects: config.pushProjects } : {}),
    ...(resources.wallet
      ? { walletSessions: new WalletSessions(pool, resources.wallet, customers, config.paymentSource) }
      : {}),
    paymentSessions: new PaymentSessions(
      pool,
      payments,
      config.paymentSource,
      undefined,
      customers,
      resources.wallet,
    ),
    paymentWebhooks: new PaymentWebhookInbox(
      pool,
      payments,
      config.paymentSource,
      !!refundReconciliation,
      !!disputeReconciliation,
    ),
  });
  return {
    app,
    worker,
    drain: new OutboxDrain(pool, worker),
    ...(resources.documentScanner
      ? { documentScans: new DocumentScanWorker(pool, resources.documentScanner) }
      : {}),
    searchExpiry,
    ...(captureFees ? { captureFees } : {}),
    ...(driverTransfers ? { driverTransfers } : {}),
    ...(refundReconciliation ? { refundReconciliation } : {}),
    ...(disputeReconciliation ? { disputeReconciliation } : {}),
    ...(pushDelivery ? { pushDelivery } : {}),
    ...(payoutReconciliation ? { payoutReconciliation } : {}),
    close: async () => {
      try {
        await database.close();
      } finally {
        resources.documentCleanup?.close?.();
        resources.documentScanner?.close?.();
        resources.documentDownloads?.close?.();
      }
    },
  };
}
/** Only validated environment configuration can construct the real deployment resources. */
export function createRuntime(env: Record<string, string | undefined>) {
  const config = readRuntimeConfig(env);
  // Cleanup never inherits upload credentials or the ambient AWS credential chain.
  const cleanupCredentials = config.documentCleanup
    ? awsCredentialsProvider({
        roleArn: config.documentCleanup.roleArn,
        clientConfig: {
          region: config.documentCleanup.storage.region,
          maxAttempts: 2,
          ignoreConfiguredEndpointUrls: true,
        },
      })
    : undefined;
  const inventory = config.documentCleanup
    ? new S3DocumentInventory(config.documentCleanup.storage, undefined, cleanupCredentials!)
    : undefined;
  const erasure = config.documentCleanup
    ? new S3DocumentErasure(config.documentCleanup.storage, undefined, cleanupCredentials!, inventory!)
    : undefined;
  const documentCredentials = config.documentAwsRoleArn
    ? awsCredentialsProvider({
        roleArn: config.documentAwsRoleArn,
        clientConfig: {
          region: (config.documentStorage ?? config.documentScanning)!.region,
          maxAttempts: 2,
          ignoreConfiguredEndpointUrls: true,
        },
      })
    : undefined;
  const payments = new StripePaymentProvider({ ...config.payments, live: config.payments.mode === 'live' });
  const maps = new GoogleMapsProvider(config.googleMapsApiKey, config.serviceArea);
  const verifyIdentity = oidcIdentity({
    issuer: config.oidcIssuer,
    audience: config.oidcAudience,
    jwksUrl: config.oidcJwksUrl,
    requireVerifiedEmail: config.oidcRequireVerifiedEmail,
  });
  const verificationProvider = config.verificationEmail
    ? new Auth0VerificationEmail(config.verificationEmail)
    : undefined;
  const verificationEmail = verificationProvider
    ? {
        verifyIdentity: oidcIdentity({
          issuer: config.oidcIssuer,
          audience: config.oidcAudience,
          jwksUrl: config.oidcJwksUrl,
          requireVerifiedEmail: false,
        }),
        request: (subject: string) => verificationProvider.request(subject),
      }
    : undefined;
  const database = createDatabase(config.databaseUrl);
  // pg emits idle-client errors outside queries. Keep the process alive; never log driver error details.
  database.pool.on('error', () => console.error('Database connection interrupted.'));
  const driverPayoutProvider = config.connect
    ? new StripeDriverPayouts({
        secretKey: config.payments.secretKey,
        live: config.payments.mode === 'live',
        origin: config.connect.origin,
      })
    : undefined;
  return composeRuntime(config, {
    ...(inventory && erasure
      ? {
          documentCleanup: {
            discover: (id: string) => inventory.discover(id),
            erase: (target: Parameters<S3DocumentErasure['erase']>[0]) => erasure.erase(target),
            close: () => {
              inventory.close();
              erasure.close();
            },
          },
        }
      : {}),
    ...(config.accountClosure
      ? { identityDeletion: new Auth0IdentityDeletion(config.accountClosure.identity) }
      : {}),
    ...(config.bankPayoutsEnabled && driverPayoutProvider
      ? {
          bankPayoutProvider: new StripeBankPayouts(
            {
              secretKey: config.payments.secretKey,
              live: config.payments.mode === 'live',
              platformAccountId: config.payments.accountId,
            },
            driverPayoutProvider,
          ),
        }
      : {}),
    ...(config.captureAccountingEnabled
      ? {
          captureBalanceProvider: new StripeCaptureBalances({
            secretKey: config.payments.secretKey,
            live: config.payments.mode === 'live',
            platformAccountId: config.payments.accountId,
          }),
        }
      : {}),
    ...(config.driverTransfersEnabled && driverPayoutProvider
      ? {
          driverTransferProvider: new StripeDriverTransfers(
            {
              secretKey: config.payments.secretKey,
              live: config.payments.mode === 'live',
              platformAccountId: config.payments.accountId,
            },
            driverPayoutProvider,
          ),
        }
      : {}),
    ...(verificationEmail ? { verificationEmail } : {}),
    wallet: new StripeWalletProvider({ ...config.payments, live: config.payments.mode === 'live' }),
    ...(config.documentScanning
      ? {
          documentScanner: new GuardDutyDocumentScanner(
            config.documentScanning,
            undefined,
            documentCredentials,
          ),
          documentDownloads: new S3DocumentDownloads(
            {
              bucket: config.documentScanning.bucket,
              region: config.documentScanning.region,
              ownerAccountId: config.documentScanning.ownerAccountId,
            },
            undefined,
            undefined,
            documentCredentials,
          ),
        }
      : {}),
    ...(config.documentStorage
      ? {
          documentTransfers: {
            forms: new S3DocumentUploadForms(config.documentStorage, undefined, documentCredentials),
            inbox: new S3DocumentInbox(config.documentStorage, undefined, documentCredentials),
            quarantine: new S3DocumentStore(config.documentStorage, undefined, documentCredentials),
          },
        }
      : {}),
    ...(config.pushAccessToken ? { pushProvider: new ExpoPushProvider(config.pushAccessToken) } : {}),
    database,
    maps,
    payments,
    refundProvider: payments,
    disputeProvider: payments,
    verifyIdentity,
    ...(config.connect
      ? {
          payoutWebhookVerifier: new StripePayoutWebhookVerifier({
            secretKey: config.payments.secretKey,
            webhookSecret: config.connect.webhookSecret,
            live: config.payments.mode === 'live',
          }),
          driverPayoutProvider: driverPayoutProvider!,
        }
      : {}),
  });
}
