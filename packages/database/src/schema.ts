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
export const drivers = pgTable('drivers', {
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
});
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
      sql`${t.account} in ('stripe_clearing','rider_funds','driver_payable','platform_revenue')`,
    ),
    check(
      'ledger_scoped_owner',
      sql`(${t.account} in ('rider_funds','driver_payable')) = (${t.ownerId} is not null)`,
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
