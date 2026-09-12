import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';

export const rideStatus = pgEnum('ride_status', [
  'searching',
  'matched',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'no_driver_found',
  'no_show',
  'interrupted',
  'terminated',
]);
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    subject: text().notNull().unique(),
    name: text().notNull(),
    role: text().notNull(),
    disabled: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('valid_user_role', sql`${t.role} in ('rider', 'driver', 'staff')`)],
);
export const drivers = pgTable(
  'drivers',
  {
    coverageRadiusMiles: integer().notNull().default(25),
    id: uuid()
      .primaryKey()
      .references(() => users.id),
    approved: boolean().notNull().default(false),
    online: boolean().notNull().default(false),
    service: text().notNull().default('standard'),
    payoutReady: boolean().notNull().default(false),
    payoutValidUntil: timestamp({ withTimezone: true }),
    eligibilityExpiresAt: timestamp({ withTimezone: true }),
    locationSequence: integer().notNull().default(0),
    location: jsonb(),
    locationAt: timestamp({ withTimezone: true }),
    locationSampledAt: timestamp({ withTimezone: true }),
    vehicle: jsonb(),
  },
  (t) => [check('driver_coverage_radius_range', sql`${t.coverageRadiusMiles} BETWEEN 1 AND 100`)],
);
export const quotes = pgTable('quotes', {
  id: uuid().primaryKey(),
  riderId: uuid()
    .notNull()
    .references(() => users.id),
  snapshot: jsonb().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const rides = pgTable(
  'rides',
  {
    id: uuid().primaryKey().defaultRandom(),
    quoteId: uuid()
      .notNull()
      .references(() => quotes.id)
      .unique(),
    riderId: uuid()
      .notNull()
      .references(() => users.id),
    driverId: uuid().references(() => drivers.id),
    state: rideStatus().notNull().default('searching'),
    version: integer().notNull().default(1),
    fareCents: integer().notNull(),
    earningsCents: integer().notNull(),
    paymentState: text().notNull().default('pending'),
    searchDeadline: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('positive_ride_money', sql`${t.fareCents} >= 0 and ${t.earningsCents} >= 0`),
    check('positive_ride_version', sql`${t.version} > 0`),
    uniqueIndex('one_active_ride_per_rider')
      .on(t.riderId)
      .where(sql`${t.state} in ('searching','matched','en_route','arrived','in_progress','interrupted')`),
    uniqueIndex('one_active_ride_per_driver')
      .on(t.driverId)
      .where(sql`${t.state} in ('matched','en_route','arrived','in_progress','interrupted')`),
  ],
);
export const offers = pgTable(
  'offers',
  {
    id: uuid().primaryKey().defaultRandom(),
    rideId: uuid()
      .notNull()
      .references(() => rides.id),
    driverId: uuid()
      .notNull()
      .references(() => drivers.id),
    status: text().notNull().default('pending'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    snapshot: jsonb().notNull(),
  },
  (t) => [
    check('valid_offer_status', sql`${t.status} in ('pending','accepted','declined','expired','revoked')`),
    uniqueIndex('one_pending_offer_per_ride')
      .on(t.rideId)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex('one_pending_offer_per_driver')
      .on(t.driverId)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex('driver_offered_once_per_ride').on(t.rideId, t.driverId),
  ],
);
export const commands = pgTable(
  'commands',
  {
    id: uuid().primaryKey().defaultRandom(),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    key: text().notNull(),
    fingerprint: text().notNull(),
    result: jsonb().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('actor_command_key').on(t.actorId, t.key)],
);
export const outbox = pgTable('outbox', {
  id: uuid().primaryKey().defaultRandom(),
  topic: text().notNull(),
  aggregateId: uuid().notNull(),
  payload: jsonb().notNull(),
  dedupeKey: text().notNull().unique(),
  attempts: integer().notNull().default(0),
  availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  leaseToken: uuid(),
  deadLetterAt: timestamp({ withTimezone: true }),
  lastErrorCode: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const audit = pgTable('audit', {
  id: uuid().primaryKey().defaultRandom(),
  actorId: uuid().references(() => users.id),
  action: text().notNull(),
  aggregateId: uuid().notNull(),
  metadata: jsonb().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const driverTrackingSessions = pgTable('driver_tracking_sessions', {
  driverId: uuid()
    .primaryKey()
    .references(() => drivers.id),
  tokenHash: text().notNull().unique(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  sampledAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// One bounded counter per authenticated subject/policy. No bearer tokens or raw identity strings.
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    key: text().primaryKey(),
    count: integer().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    index('rate_limit_expiry').on(t.expiresAt),
    check('rate_limit_positive_count', sql`${t.count} > 0`),
    check('rate_limit_digest_key', sql`${t.key} ~ '^[a-f0-9]{64}$'`),
  ],
);

// Minimal verified event references only: no raw webhook body, card data or client secrets.
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text().notNull(),
    eventId: text().notNull(),
    eventType: text().notNull(),
    resourceId: text().notNull(),
    providerCreated: integer().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_webhook_source_event').on(t.source, t.eventId)],
);

export const paymentCustomers = pgTable(
  'payment_customers',
  {
    id: uuid().primaryKey().defaultRandom(),
    riderId: uuid()
      .notNull()
      .references(() => users.id),
    source: text().notNull(),
    customerId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_customer_rider_source').on(t.riderId, t.source),
    uniqueIndex('payment_customer_provider_source').on(t.source, t.customerId),
  ],
);
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    rideId: uuid()
      .notNull()
      .references(() => rides.id)
      .unique(),
    customerBindingId: uuid()
      .notNull()
      .references(() => paymentCustomers.id),
    intentId: text(),
    source: text().notNull(),
    amountCents: integer().notNull(),
    revision: integer().notNull().default(0),
    providerStatus: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    reconciledAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('payment_attempt_provider_source').on(t.source, t.intentId),
    check('valid_payment_attempt_amount', sql`${t.amountCents} >= 50 and ${t.amountCents} <= 99999999`),
    check('valid_payment_attempt_revision', sql`${t.revision} >= 0`),
  ],
);

export const ledgerJournals = pgTable('ledger_journals', {
  id: uuid().primaryKey().defaultRandom(),
  key: text().notNull().unique(),
  fingerprint: text().notNull(),
  attemptId: uuid()
    .notNull()
    .references(() => paymentAttempts.id),
  rideId: uuid()
    .notNull()
    .references(() => rides.id),
  kind: text().notNull(),
  createdTransaction: text()
    .notNull()
    .default(sql`pg_current_xact_id()::text`),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const ledgerPostings = pgTable(
  'ledger_postings',
  {
    id: uuid().primaryKey().defaultRandom(),
    journalId: uuid()
      .notNull()
      .references(() => ledgerJournals.id),
    account: text().notNull(),
    ownerId: uuid().references(() => users.id),
    amountCents: integer().notNull(),
  },
  (t) => [
    index('ledger_postings_journal').on(t.journalId),
    index('ledger_postings_owner_account').on(t.ownerId, t.account),
    check('ledger_nonzero_amount', sql`${t.amountCents} <> 0`),
    check(
      'ledger_valid_account',
      sql`${t.account} in ('stripe_clearing','rider_funds','driver_payable','platform_revenue','refund_suspense','processor_fees','dispute_suspense','platform_payment_losses','driver_transfer_pending')`,
    ),
    check(
      'ledger_scoped_owner',
      sql`(${t.account} in ('rider_funds','driver_payable','driver_transfer_pending')) = (${t.ownerId} is not null)`,
    ),
  ],
);

// Persist user-chosen labels and provider IDs, not indefinitely cached provider addresses.
export const savedPlaces = pgTable(
  'saved_places',
  {
    id: uuid().primaryKey().defaultRandom(),
    riderId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    placeId: text().notNull(),
  },
  (table) => [
    uniqueIndex('saved_places_rider_kind').on(table.riderId, table.kind),
    check('saved_places_kind', sql`${table.kind} IN ('home', 'work')`),
    check('saved_places_id_length', sql`length(${table.placeId}) BETWEEN 1 AND 512`),
  ],
);

export const driverVehicleSubmissions = pgTable(
  'driver_vehicle_submissions',
  {
    driverId: uuid()
      .primaryKey()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    revision: uuid().notNull(),
    vehicle: jsonb().notNull(),
    status: text().notNull().default('pending'),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('driver_vehicle_submission_status', sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  ],
);

// Historical submitted facts; review decisions belong to a separate audited workflow.
export const driverVehicleHistory = pgTable(
  'driver_vehicle_history',
  {
    revision: uuid().primaryKey(),
    driverId: uuid()
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    vehicle: jsonb().notNull(),
    submittedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index('driver_vehicle_history_owner').on(table.driverId, table.submittedAt)],
);

export const staffPermissions = pgTable(
  'staff_permissions',
  {
    id: uuid().primaryKey().defaultRandom(),
    staffId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text().notNull(),
  },
  (table) => [uniqueIndex('staff_permission_unique').on(table.staffId, table.permission)],
);
export const vehicleReviewDecisions = pgTable(
  'vehicle_review_decisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    revision: uuid()
      .notNull()
      .unique()
      .references(() => driverVehicleHistory.revision, { onDelete: 'cascade' }),
    reviewerId: uuid()
      .notNull()
      .references(() => users.id),
    decision: text().notNull(),
    reason: text().notNull(),
    verifiedService: text(),
    corrections: jsonb().notNull().default([]),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('vehicle_review_decision_value', sql`${table.decision} IN ('approved','rejected')`)],
);

export const supportRequests = pgTable(
  'support_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text().notNull(),
    message: text().notNull(),
    status: text().notNull().default('open'),
    response: text(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolvedBy: uuid().references(() => users.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('support_requests_owner').on(table.ownerId, table.createdAt),
    index('support_requests_queue').on(table.status, table.createdAt, table.id),
    check('support_request_status', sql`${table.status} IN ('open','resolved')`),
    check(
      'support_request_category',
      sql`${table.category} IN ('account','vehicle','trip','payment','other')`,
    ),
    check('support_request_message_length', sql`length(${table.message}) BETWEEN 10 AND 2000`),
  ],
);

export const driverPayoutAccounts = pgTable(
  'driver_payout_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    driverId: uuid()
      .notNull()
      .references(() => drivers.id),
    source: text().notNull(),
    accountId: text(),
    syncRevision: integer().notNull().default(0),
    status: text().notNull().default('unknown'),
    checkedAt: timestamp({ withTimezone: true }),
    lastRequestedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('driver_payout_driver_source').on(t.driverId, t.source),
    uniqueIndex('driver_payout_account_source').on(t.source, t.accountId),
  ],
);

export const payoutWebhookEvents = pgTable(
  'payout_webhook_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text().notNull(),
    eventId: text().notNull(),
    eventType: text().notNull(),
    accountId: text().notNull(),
    providerCreated: timestamp({ withTimezone: true }).notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payout_webhook_source_event').on(t.source, t.eventId)],
);

export const pushInstallations = pgTable(
  'push_installations',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid().notNull(),
    installationId: uuid().notNull(),
    secretHash: text().notNull(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    token: text().notNull(),
    platform: text().notNull(),
    revision: integer().notNull().default(1),
    enabled: boolean().notNull().default(true),
    mutationId: uuid(),
    mutationHash: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('push_installation_identity').on(t.projectId, t.installationId),
    uniqueIndex('push_installation_active_token')
      .on(t.projectId, t.token)
      .where(sql`${t.enabled}=true`),
    check('push_installation_platform', sql`${t.platform} in ('ios','android')`),
    check('push_installation_revision', sql`${t.revision}>0`),
  ],
);

export const pushDeliveries = pgTable(
  'push_deliveries',
  {
    id: uuid().primaryKey().defaultRandom(),
    eventId: uuid()
      .notNull()
      .references(() => outbox.id),
    installationId: uuid()
      .notNull()
      .references(() => pushInstallations.id),
    revision: integer().notNull(),
    state: text().notNull().default('pending'),
    receiptId: uuid(),
    acceptedAt: timestamp({ withTimezone: true }),
    leaseToken: uuid(),
    lockedUntil: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    receiptAttempts: integer().notNull().default(0),
    lastError: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('push_delivery_recipient').on(t.eventId, t.installationId, t.revision),
    check('push_delivery_revision', sql`${t.revision}>0`),
    check(
      'push_delivery_state',
      sql`${t.state} in ('pending','sending','receipt','accepted_by_gateway','suppressed','invalid_token','configuration','rejected','receipt_expired')`,
    ),
  ],
);
export const pushRateWindows = pgTable('push_rate_windows', {
  projectId: uuid().primaryKey(),
  windowAt: timestamp({ withTimezone: true }).notNull(),
  count: integer().notNull(),
});

export const driverDocuments = pgTable(
  'driver_documents',
  {
    id: uuid().primaryKey(),
    driverId: uuid()
      .notNull()
      .references(() => drivers.id),
    kind: text().notNull(),
    contentType: text().notNull(),
    expectedSha256: text().notNull(),
    expectedBytes: integer().notNull(),
    state: text().notNull().default('reserved'),
    objectKey: text(),
    objectVersion: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    index('driver_documents_owner').on(t.driverId, t.createdAt),
    check(
      'driver_documents_kind',
      sql`${t.kind} in ('driver_license','vehicle_registration','vehicle_insurance')`,
    ),
    check('driver_documents_type', sql`${t.contentType} in ('image/jpeg','image/png','application/pdf')`),
    check('driver_documents_hash', sql`${t.expectedSha256} ~ '^[a-f0-9]{64}$'`),
    check('driver_documents_bytes', sql`${t.expectedBytes} between 1 and 10485760`),
    check('driver_documents_state', sql`${t.state} in ('reserved','quarantined')`),
    check(
      'driver_documents_object',
      sql`(${t.state}='reserved' AND ${t.objectKey} IS NULL AND ${t.objectVersion} IS NULL) OR (${t.state}='quarantined' AND ${t.objectKey} IS NOT NULL AND ${t.objectVersion} IS NOT NULL)`,
    ),
  ],
);

export const driverDocumentScans = pgTable(
  'driver_document_scans',
  {
    documentId: uuid().primaryKey(),
    state: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid(),
    lockedUntil: timestamp({ withTimezone: true }),
    scannedKey: text(),
    scannedVersion: text(),
    scannedSha256: text(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'driver_document_scans_document_id_fkey',
      columns: [t.documentId],
      foreignColumns: [driverDocuments.id],
    }),
    index('driver_document_scans_due')
      .on(t.availableAt)
      .where(sql`${t.state}='pending'`),
    check('driver_document_scans_state_check', sql`${t.state} in ('pending','clean','infected','failed')`),
    check('driver_document_scans_attempts_check', sql`${t.attempts} >= 0`),
    check('driver_document_scans_check', sql`(${t.leaseToken} IS NULL) = (${t.lockedUntil} IS NULL)`),
    check(
      'driver_document_scans_check1',
      sql`
      (${t.state} IN ('pending','failed') AND ${t.scannedKey} IS NULL AND ${t.scannedVersion} IS NULL AND ${t.scannedSha256} IS NULL AND ${t.completedAt} IS NULL)
      OR (${t.state} IN ('clean','infected') AND ${t.scannedKey} IS NOT NULL AND ${t.scannedVersion} IS NOT NULL AND ${t.scannedSha256} IS NOT NULL AND ${t.scannedSha256} ~ '^[a-f0-9]{64}$' AND ${t.completedAt} IS NOT NULL)`,
    ),
  ],
);

export const driverDocumentReviews = pgTable(
  'driver_document_reviews',
  {
    documentId: uuid()
      .primaryKey()
      .references(() => driverDocuments.id),
    reviewerId: uuid()
      .notNull()
      .references(() => users.id),
    decision: text().notNull(),
    reason: text(),
    expiresAt: timestamp({ withTimezone: true }),
    reviewedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    objectKey: text().notNull(),
    objectVersion: text().notNull(),
    sha256: text().notNull(),
  },
  (t) => [
    check('driver_document_reviews_hash', sql`${t.sha256} ~ '^[a-f0-9]{64}$'`),
    check(
      'driver_document_reviews_decision',
      sql`
      (${t.decision}='approved' AND ${t.reason} IS NULL AND ${t.expiresAt} IS NOT NULL AND ${t.expiresAt}>${t.reviewedAt})
      OR (${t.decision}='rejected' AND ${t.reason} IS NOT NULL AND ${t.reason} IN ('unreadable','wrong_document','expired','details_mismatch') AND ${t.expiresAt} IS NULL)`,
    ),
  ],
);

// The accepted offer identifies an assignment; messages never transfer to a replacement driver.
export const tripMessages = pgTable(
  'trip_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    sequence: integer().generatedAlwaysAsIdentity().notNull().unique(),
    offerId: uuid()
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    senderId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestId: uuid().notNull(),
    text: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trip_message_retry').on(t.senderId, t.requestId),
    index('trip_message_thread').on(t.offerId, t.sequence),
    index('trip_message_expiry').on(t.createdAt),
    check('trip_message_text_length', sql`length(trim(${t.text})) BETWEEN 1 AND 1000`),
  ],
);
export const tripMessageReads = pgTable(
  'trip_message_reads',
  {
    id: uuid().primaryKey().defaultRandom(),
    offerId: uuid()
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    through: integer().notNull(),
  },
  (t) => [uniqueIndex('trip_message_reader').on(t.offerId, t.ownerId)],
);
export const tripMessageReports = pgTable(
  'trip_message_reports',
  {
    id: uuid().primaryKey().defaultRandom(),
    offerId: uuid()
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    reporterId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    supportId: uuid()
      .notNull()
      .references(() => supportRequests.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('trip_message_reporter').on(t.offerId, t.reporterId)],
);

// Provider observations only; financial postings and refund approval are separate operations.
export const paymentRefundChecks = pgTable(
  'payment_refund_checks',
  {
    attemptId: uuid()
      .primaryKey()
      .references(() => paymentAttempts.id),
    revision: integer().notNull().default(0),
    refunds: jsonb().notNull().default([]),
    receivedCents: integer().notNull().default(0),
    verifiedAt: timestamp({ withTimezone: true }),
    requestedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('refund_check_revision', sql`${t.revision} >= 0`),
    check('refund_check_array', sql`jsonb_typeof(${t.refunds}) = 'array'`),
    check('refund_check_amount', sql`${t.receivedCents} >= 0 AND ${t.receivedCents} <= 99999999`),
  ],
);
export const paymentRefundObservations = pgTable(
  'payment_refund_observations',
  {
    id: uuid().primaryKey().defaultRandom(),
    attemptId: uuid()
      .notNull()
      .references(() => paymentAttempts.id),
    revision: integer().notNull(),
    refunds: jsonb().notNull(),
    receivedCents: integer().notNull(),
    verifiedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('refund_observation_revision').on(t.attemptId, t.revision),
    check('refund_observation_positive_revision', sql`${t.revision} > 0`),
    check('refund_observation_array', sql`jsonb_typeof(${t.refunds}) = 'array'`),
    check('refund_observation_amount', sql`${t.receivedCents} >= 0 AND ${t.receivedCents} <= 99999999`),
  ],
);

export const refundOperations = pgTable(
  'refund_operations',
  {
    id: uuid().primaryKey().defaultRandom(),
    attemptId: uuid()
      .notNull()
      .references(() => paymentAttempts.id),
    authorizedBy: uuid()
      .notNull()
      .references(() => users.id),
    amountCents: integer().notNull(),
    reason: text().notNull(),
    policyReference: text().notNull(),
    state: text().notNull().default('queued'),
    providerRefundId: text().unique(),
    firstAttemptAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('refund_operations_attempt').on(t.attemptId)],
);

export const paymentDisputeChecks = pgTable(
  'payment_dispute_checks',
  {
    attemptId: uuid()
      .primaryKey()
      .references(() => paymentAttempts.id),
    revision: integer().notNull().default(0),
    disputes: jsonb().notNull().default([]),
    verifiedAt: timestamp({ withTimezone: true }),
    requestedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('dispute_check_revision', sql`${t.revision} >= 0`),
    check('dispute_check_array', sql`jsonb_typeof(${t.disputes}) = 'array'`),
  ],
);
export const paymentDisputeObservations = pgTable(
  'payment_dispute_observations',
  {
    id: uuid().primaryKey().defaultRandom(),
    attemptId: uuid()
      .notNull()
      .references(() => paymentAttempts.id),
    revision: integer().notNull(),
    disputes: jsonb().notNull(),
    verifiedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('dispute_observation_revision').on(t.attemptId, t.revision),
    check('dispute_observation_positive_revision', sql`${t.revision} > 0`),
    check('dispute_observation_array', sql`jsonb_typeof(${t.disputes}) = 'array'`),
  ],
);

export const paymentLossAllocations = pgTable(
  'payment_loss_allocations',
  {
    id: uuid().primaryKey().defaultRandom(),
    journalId: uuid()
      .notNull()
      .unique()
      .references(() => ledgerJournals.id),
    authorizedBy: uuid()
      .notNull()
      .references(() => users.id),
    policyReference: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('loss_policy_reference', sql`length(${t.policyReference}) between 1 and 128`)],
);

export const driverTransferOperations = pgTable(
  'driver_transfer_operations',
  {
    id: uuid().primaryKey().defaultRandom(),
    attemptId: uuid()
      .notNull()
      .references(() => paymentAttempts.id),
    driverId: uuid()
      .notNull()
      .references(() => drivers.id),
    payoutBindingId: uuid()
      .notNull()
      .references(() => driverPayoutAccounts.id),
    accountId: text().notNull(),
    authorizedBy: uuid()
      .notNull()
      .references(() => users.id),
    amountCents: integer().notNull(),
    policyReference: text().notNull(),
    state: text().notNull().default('queued'),
    firstAttemptAt: timestamp({ withTimezone: true }),
    chargeId: text(),
    providerTransferId: text().unique(),
    revision: integer().notNull().default(0),
    reversedCents: integer().notNull().default(0),
    checkedAt: timestamp({ withTimezone: true }),
    requestedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('driver_transfer_attempt').on(t.attemptId),
    index('driver_transfer_recovery').on(t.requestedAt, t.createdAt),
    check('driver_transfer_amount', sql`${t.amountCents} between 1 and 99999999`),
    check('driver_transfer_policy', sql`length(${t.policyReference}) between 1 and 128`),
    check('driver_transfer_state', sql`${t.state} in ('queued','confirmed','review_required','canceled')`),
    check('driver_transfer_revision', sql`${t.revision} >= 0`),
    check('driver_transfer_reversed', sql`${t.reversedCents} between 0 and ${t.amountCents}`),
    check('driver_transfer_account', sql`${t.accountId} ~ '^acct_[a-zA-Z0-9]{1,96}$'`),
    check('driver_transfer_charge', sql`${t.chargeId} is null or ${t.chargeId} ~ '^ch_[a-zA-Z0-9]{1,96}$'`),
    check(
      'driver_transfer_provider',
      sql`${t.providerTransferId} is null or ${t.providerTransferId} ~ '^tr_[a-zA-Z0-9]{1,96}$'`,
    ),
    check('driver_transfer_attempt_frozen', sql`(${t.firstAttemptAt} is null) = (${t.chargeId} is null)`),
    check(
      'driver_transfer_confirmation',
      sql`(${t.state} <> 'confirmed' or ${t.providerTransferId} is not null) and (${t.providerTransferId} is null or ${t.firstAttemptAt} is not null) and (${t.state} <> 'canceled' or ${t.firstAttemptAt} is null)`,
    ),
  ],
);

export const driverTransferMovements = pgTable(
  'driver_transfer_movements',
  {
    source: text().notNull(),
    balanceId: text().notNull(),
    operationId: uuid()
      .notNull()
      .references(() => driverTransferOperations.id),
    journalId: uuid()
      .notNull()
      .unique()
      .references(() => ledgerJournals.id),
  },
  (t) => [
    uniqueIndex('driver_transfer_movement_source').on(t.source, t.balanceId),
    index('driver_transfer_movement_operation').on(t.operationId),
  ],
);

export const paymentCaptureChecks = pgTable(
  'payment_capture_checks',
  {
    attemptId: uuid()
      .primaryKey()
      .references(() => paymentAttempts.id),
    source: text().notNull(),
    revision: integer().notNull().default(0),
    chargeId: text(),
    balanceId: text(),
    amountCents: integer(),
    feeCents: integer(),
    netCents: integer(),
    journalId: uuid()
      .unique()
      .references(() => ledgerJournals.id),
    verifiedAt: timestamp({ withTimezone: true }),
    checkedAt: timestamp({ withTimezone: true }),
    requestedAt: timestamp({ withTimezone: true }),
    reviewRequired: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex('capture_balance_source').on(t.source, t.balanceId),
    check('capture_check_revision', sql`${t.revision} >= 0`),
    check('capture_check_source', sql`${t.source} ~ '^acct_[a-zA-Z0-9]{1,96}:(test|live)$'`),
    check(
      'capture_check_facts',
      sql`(
      ${t.chargeId} is null and ${t.balanceId} is null and ${t.amountCents} is null and ${t.feeCents} is null and ${t.netCents} is null and ${t.journalId} is null and ${t.verifiedAt} is null
    ) or (
      ${t.chargeId} is not null and ${t.chargeId} ~ '^ch_[a-zA-Z0-9]{1,96}$' and ${t.balanceId} is not null and ${t.balanceId} ~ '^txn_[a-zA-Z0-9]{1,96}$'
      and ${t.amountCents} is not null and ${t.amountCents} between 1 and 99999999
      and ${t.feeCents} is not null and ${t.feeCents} between 0 and ${t.amountCents}
      and ${t.netCents} is not null and ${t.netCents} = ${t.amountCents} - ${t.feeCents}
      and ${t.verifiedAt} is not null and ((${t.feeCents} = 0 and ${t.journalId} is null) or (${t.feeCents} > 0 and ${t.journalId} is not null))
    )`,
    ),
  ],
);

// Explicit consumer consent is independent of support ticket resolution.
export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    supportRequestId: uuid()
      .notNull()
      .references(() => supportRequests.id),
    consentVersion: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('account_deletion_owner').on(t.ownerId),
    uniqueIndex('account_deletion_support').on(t.supportRequestId),
    check('account_deletion_consent', sql`${t.consentVersion} = 'account-deletion-v1'`),
  ],
);

export const accountClosures = pgTable(
  'account_closures',
  {
    requestId: uuid()
      .primaryKey()
      .references(() => accountDeletionRequests.id),
    ownerId: uuid()
      .notNull()
      .unique()
      .references(() => users.id),
    authorizedBy: uuid()
      .notNull()
      .references(() => users.id),
    policyReference: text().notNull(),
    reviewReference: text().notNull(),
    closedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    identityRemovedAt: timestamp({ withTimezone: true }),
    identityAttemptedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('account_closure_policy', sql`length(${t.policyReference}) between 1 and 128`),
    check('account_closure_review', sql`length(${t.reviewReference}) between 1 and 128`),
    check(
      'account_closure_identity_time',
      sql`${t.identityRemovedAt} is null or ${t.identityRemovedAt} >= ${t.closedAt}`,
    ),
  ],
);

export const retentionHolds = pgTable(
  'retention_holds',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    kind: text().notNull(),
    reasonReference: text().notNull(),
    reviewAt: timestamp({ withTimezone: true }).notNull(),
    placedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    releasedBy: uuid().references(() => users.id),
    releasedAt: timestamp({ withTimezone: true }),
    releaseReference: text(),
  },
  (t) => [
    uniqueIndex('retention_active_case')
      .on(t.ownerId, t.kind, t.reasonReference)
      .where(sql`${t.releasedAt} is null`),
    index('retention_review_queue').on(t.reviewAt, t.id),
    check('retention_hold_kind', sql`${t.kind} in ('legal','safety','privacy')`),
    check('retention_hold_reference', sql`length(${t.reasonReference}) between 1 and 128`),
    check(
      'retention_hold_release',
      sql`(${t.releasedAt} is null and ${t.releasedBy} is null and ${t.releaseReference} is null) or (${t.releasedAt} is not null and ${t.releasedBy} is not null and ${t.releaseReference} is not null and length(${t.releaseReference}) between 1 and 128 and ${t.releasedAt}>=${t.createdAt})`,
    ),
  ],
);

export const documentStorageWrites = pgTable(
  'document_storage_writes',
  {
    objectKey: text().primaryKey(),
    documentId: uuid()
      .notNull()
      .references(() => driverDocuments.id),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp({ withTimezone: true }),
    objectVersion: text(),
  },
  (t) => [
    index('document_storage_writes_pending')
      .on(t.documentId)
      .where(sql`${t.settledAt} is null`),
    check(
      'document_storage_write_result',
      sql`(${t.settledAt} is null and ${t.objectVersion} is null) or (${t.settledAt} is not null and ${t.settledAt}>=${t.startedAt} and ${t.objectVersion} is not null and length(${t.objectVersion}) between 1 and 1024 and ${t.objectVersion}<>'null')`,
    ),
  ],
);

export const documentCleanupPlans = pgTable(
  'document_cleanup_plans',
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: uuid()
      .notNull()
      .references(() => driverDocuments.id),
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    manifestHash: text().notNull(),
    deleteMarkers: integer().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
    notBefore: timestamp({ withTimezone: true }),
    policyReference: text(),
    reviewReference: text(),
    quiescenceReference: text(),
  },
  (t) => [
    check('document_cleanup_hash', sql`${t.manifestHash} ~ '^[a-f0-9]{64}$'`),
    check('document_cleanup_markers', sql`${t.deleteMarkers} >= 0`),
    check(
      'document_cleanup_approval',
      sql`(${t.approvedAt} is null and ${t.approvedBy} is null and ${t.notBefore} is null and ${t.policyReference} is null and ${t.reviewReference} is null and ${t.quiescenceReference} is null) or (${t.approvedAt} is not null and ${t.approvedAt}>=${t.createdAt} and ${t.approvedBy} is not null and ${t.notBefore} is not null and ${t.policyReference} is not null and ${t.reviewReference} is not null and ${t.quiescenceReference} is not null and length(${t.policyReference}) between 1 and 128 and length(${t.reviewReference}) between 1 and 128 and length(${t.quiescenceReference}) between 1 and 128)`,
    ),
  ],
);
export const documentCleanupItems = pgTable(
  'document_cleanup_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    planId: uuid()
      .notNull()
      .references(() => documentCleanupPlans.id),
    objectKey: text().notNull(),
    objectVersion: text().notNull(),
    attemptedAt: timestamp({ withTimezone: true }),
    removedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('document_cleanup_version').on(t.planId, t.objectKey, t.objectVersion),
    check(
      'document_cleanup_version_id',
      sql`length(${t.objectVersion}) between 1 and 1024 and ${t.objectVersion}<>'null'`,
    ),
    check(
      'document_cleanup_removal',
      sql`${t.removedAt} is null or (${t.attemptedAt} is not null and ${t.removedAt}>=${t.attemptedAt})`,
    ),
  ],
);
