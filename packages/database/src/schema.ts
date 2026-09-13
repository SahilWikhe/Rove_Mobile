import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  pgTable,
  pgPolicy,
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
    index('completed_rides_by_driver')
      .on(t.driverId)
      .where(sql`${t.state} = 'completed'`),
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
    index('accepted_offers_by_driver')
      .on(t.driverId)
      .where(sql`${t.status} = 'accepted'`),
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
// Identity is installed only by trusted backend transactions; no anonymous/default access.
const rlsActor = sql`NULLIF(current_setting('rove.actor_id', true), '')::uuid`;
const rlsPermissions = {
  'privacy.read': sql`p.permission='privacy.read'`,
  'privacy.close': sql`p.permission='privacy.close'`,
  'privacy.cleanup': sql`p.permission='privacy.cleanup'`,
  'privacy.hold': sql`p.permission='privacy.hold'`,
  'privacy.release-hold': sql`p.permission='privacy.release-hold'`,
  'driver.vehicle.review': sql`p.permission='driver.vehicle.review'`,
  'driver.document.review': sql`p.permission='driver.document.review'`,
  'driver.eligibility.review': sql`p.permission='driver.eligibility.review'`,
  'support.read': sql`p.permission='support.read'`,
  'support.resolve': sql`p.permission='support.resolve'`,
};
const rlsStaff = (
  permission: keyof typeof rlsPermissions,
) => sql`current_setting('rove.actor_role', true) = 'staff'
  AND current_setting('rove.actor_mfa', true) = 'true'
  AND EXISTS (SELECT 1 FROM public.users u JOIN public.staff_permissions p ON p.staff_id=u.id
    WHERE u.id=${rlsActor} AND u.role='staff' AND u.disabled=false AND ${rlsPermissions[permission]})`;
const rlsConsumer = (
  owner: SQLWrapper,
) => sql`${owner}=${rlsActor} AND current_setting('rove.actor_role',true) IN ('rider','driver')
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${rlsActor} AND u.role=current_setting('rove.actor_role',true) AND u.disabled=false)`;

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
    pgPolicy('saved_places_owner', {
      for: 'all',
      using: sql`${table.riderId}=${rlsActor} AND current_setting('rove.actor_role',true)='rider'
        AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${rlsActor} AND u.role='rider' AND u.disabled=false)`,
      withCheck: sql`${table.riderId}=${rlsActor} AND current_setting('rove.actor_role',true)='rider'
        AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${rlsActor} AND u.role='rider' AND u.disabled=false)`,
    }),
    pgPolicy('saved_places_privacy_read', { for: 'select', using: rlsStaff('privacy.read') }),
    pgPolicy('saved_places_closure_read', {
      for: 'select',
      using: sql`${rlsStaff('privacy.close')} AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${table.riderId} AND u.disabled=true)`,
    }),
    pgPolicy('saved_places_closure_delete', {
      for: 'delete',
      using: sql`${rlsStaff('privacy.close')} AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${table.riderId} AND u.disabled=true)`,
    }),
    uniqueIndex('saved_places_rider_kind').on(table.riderId, table.kind),
    check('saved_places_kind', sql`${table.kind} IN ('home', 'work')`),
    check('saved_places_id_length', sql`length(${table.placeId}) BETWEEN 1 AND 512`),
  ],
);

const rlsDriver = (
  owner: SQLWrapper,
) => sql`${owner}=${rlsActor} AND current_setting('rove.actor_role',true)='driver'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${rlsActor} AND u.role='driver' AND u.disabled=false)`;

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
    pgPolicy('vehicle_submission_read', {
      for: 'select',
      using: sql`${rlsDriver(table.driverId)} OR ${rlsStaff('driver.vehicle.review')} OR ${rlsStaff('driver.eligibility.review')}`,
    }),
    pgPolicy('vehicle_submission_insert', {
      for: 'insert',
      withCheck: sql`${rlsDriver(table.driverId)} AND ${table.status}='pending'`,
    }),
    pgPolicy('vehicle_submission_update', {
      for: 'update',
      using: sql`${rlsDriver(table.driverId)} OR ${rlsStaff('driver.vehicle.review')}`,
      withCheck: sql`(${rlsDriver(table.driverId)} AND ${table.status}='pending') OR ${rlsStaff('driver.vehicle.review')}`,
    }),
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
  (table) => [
    index('driver_vehicle_history_owner').on(table.driverId, table.submittedAt),
    pgPolicy('vehicle_history_read', {
      for: 'select',
      using: sql`${rlsDriver(table.driverId)} OR ${rlsStaff('driver.vehicle.review')}`,
    }),
    pgPolicy('vehicle_history_insert', { for: 'insert', withCheck: rlsDriver(table.driverId) }),
  ],
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
  (table) => [
    check('vehicle_review_decision_value', sql`${table.decision} IN ('approved','rejected')`),
    pgPolicy('vehicle_decision_read', {
      for: 'select',
      using: sql`${rlsStaff('driver.vehicle.review')} OR EXISTS(SELECT 1 FROM public.driver_vehicle_history h WHERE h.revision=${table.revision} AND h.driver_id=${rlsActor} AND current_setting('rove.actor_role',true)='driver')`,
    }),
    pgPolicy('vehicle_decision_insert', {
      for: 'insert',
      withCheck: sql`${rlsStaff('driver.vehicle.review')} AND ${table.reviewerId}=${rlsActor}`,
    }),
  ],
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
    pgPolicy('support_owner_read', { for: 'select', using: rlsConsumer(table.ownerId) }),
    pgPolicy('support_owner_insert', {
      for: 'insert',
      withCheck: sql`${rlsConsumer(table.ownerId)} AND ${table.status}='open' AND ${table.response} IS NULL AND ${table.resolvedAt} IS NULL AND ${table.resolvedBy} IS NULL`,
    }),
    pgPolicy('support_staff_read', {
      for: 'select',
      using: sql`${rlsStaff('support.read')} OR ${rlsStaff('privacy.read')}`,
    }),
    pgPolicy('support_staff_resolve', {
      for: 'update',
      using: sql`${rlsStaff('support.read')} AND ${rlsStaff('support.resolve')}`,
      withCheck: sql`${rlsStaff('support.read')} AND ${rlsStaff('support.resolve')} AND ${table.status}='resolved' AND ${table.resolvedBy}=${rlsActor} AND ${table.resolvedAt} IS NOT NULL AND ${table.response} IS NOT NULL`,
    }),
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

const rlsDocumentStaff = sql`${rlsStaff('driver.document.review')} OR ${rlsStaff('driver.eligibility.review')} OR ${rlsStaff('privacy.read')} OR ${rlsStaff('privacy.cleanup')}`;

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
    pgPolicy('document_owner_read', { for: 'select', using: rlsDriver(t.driverId) }),
    pgPolicy('document_owner_insert', {
      for: 'insert',
      withCheck: sql`${rlsDriver(t.driverId)} AND ${t.state}='reserved'`,
    }),
    pgPolicy('document_owner_update', {
      for: 'update',
      using: rlsDriver(t.driverId),
      withCheck: rlsDriver(t.driverId),
    }),
    pgPolicy('document_staff_read', { for: 'select', using: rlsDocumentStaff }),
    pgPolicy('document_staff_lock', { for: 'update', using: rlsDocumentStaff, withCheck: sql`false` }),
    pgPolicy('document_scanner_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.state}='quarantined' AND (current_setting('rove.scan_queue',true)='true' OR ${t.id}=NULLIF(current_setting('rove.scan_document',true),'')::uuid)`,
    }),
    pgPolicy('document_cleanup_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND EXISTS(SELECT 1 FROM public.document_cleanup_items i JOIN public.document_cleanup_plans p ON p.id=i.plan_id WHERE i.id=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid AND p.owner_id=${t.driverId})`,
    }),
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
    pgPolicy('scan_actor_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=${t.documentId})`,
    }),
    pgPolicy('scan_owner_queue', {
      for: 'insert',
      withCheck: sql`current_setting('rove.actor_role',true)='driver' AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=${t.documentId} AND d.driver_id=NULLIF(current_setting('rove.actor_id',true),'')::uuid AND d.state='quarantined') AND ${t.state}='pending' AND ${t.attempts}=0 AND ${t.leaseToken} IS NULL AND ${t.lockedUntil} IS NULL AND ${t.scannedKey} IS NULL AND ${t.scannedVersion} IS NULL AND ${t.scannedSha256} IS NULL AND ${t.completedAt} IS NULL`,
    }),
    pgPolicy('scan_staff_lock', { for: 'update', using: rlsDocumentStaff, withCheck: sql`false` }),
    pgPolicy('scan_worker_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND (current_setting('rove.scan_queue',true)='true' OR ${t.documentId}=NULLIF(current_setting('rove.scan_document',true),'')::uuid) AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=${t.documentId} AND d.state='quarantined')`,
    }),
    pgPolicy('scan_worker_claim', {
      for: 'update',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND current_setting('rove.scan_queue',true)='true' AND ${t.state}='pending' AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=${t.documentId} AND d.state='quarantined')`,
      withCheck: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND current_setting('rove.scan_queue',true)='true' AND ${t.state}='pending'`,
    }),
    pgPolicy('scan_worker_result', {
      for: 'update',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.documentId}=NULLIF(current_setting('rove.scan_document',true),'')::uuid AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=${t.documentId} AND d.state='quarantined')`,
      withCheck: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.documentId}=NULLIF(current_setting('rove.scan_document',true),'')::uuid`,
    }),
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
    pgPolicy('document_review_owner_read', {
      for: 'select',
      using: sql`current_setting('rove.actor_role',true)='driver' AND EXISTS(SELECT 1 FROM public.driver_documents d JOIN public.users u ON u.id=d.driver_id WHERE d.id=${t.documentId} AND d.driver_id=${rlsActor} AND u.role='driver' AND u.disabled=false)`,
    }),
    pgPolicy('document_review_staff_read', {
      for: 'select',
      using: sql`${rlsStaff('driver.document.review')} OR ${rlsStaff('driver.eligibility.review')}`,
    }),
    pgPolicy('document_review_staff_insert', {
      for: 'insert',
      withCheck: sql`${rlsStaff('driver.document.review')} AND ${t.reviewerId}=${rlsActor}`,
    }),
    check('driver_document_reviews_hash', sql`${t.sha256} ~ '^[a-f0-9]{64}$'`),
    check(
      'driver_document_reviews_decision',
      sql`
      (${t.decision}='approved' AND ${t.reason} IS NULL AND ${t.expiresAt} IS NOT NULL AND ${t.expiresAt}>${t.reviewedAt})
      OR (${t.decision}='rejected' AND ${t.reason} IS NOT NULL AND ${t.reason} IN ('unreadable','wrong_document','expired','details_mismatch') AND ${t.expiresAt} IS NULL)`,
    ),
  ],
);

const rlsAssignment = (offer: SQLWrapper, activeOnly = false) => sql`EXISTS (
  SELECT 1 FROM public.offers o JOIN public.rides r ON r.id=o.ride_id
  JOIN public.users rider ON rider.id=r.rider_id JOIN public.users driver ON driver.id=o.driver_id
  WHERE o.id=${offer} AND o.status='accepted' AND r.driver_id=o.driver_id
    AND rider.disabled=false AND driver.disabled=false
    AND ((current_setting('rove.actor_role',true)='rider' AND r.rider_id=${rlsActor})
      OR (current_setting('rove.actor_role',true)='driver' AND o.driver_id=${rlsActor}))
    AND ${activeOnly ? sql`r.state IN ('matched','en_route','arrived','in_progress','interrupted')` : sql`(r.state IN ('matched','en_route','arrived','in_progress','interrupted') OR r.updated_at>now()-interval '30 days')`}
)`;
const rlsNotification = (column: SQLWrapper, kind: 'message' | 'offer') => sql`
  COALESCE(current_setting('rove.actor_id',true),'')='' AND ${column}=NULLIF(current_setting(${kind === 'message' ? sql`'rove.notification_message'` : sql`'rove.notification_offer'`},true),'')::uuid`;

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
    pgPolicy('messages_participant_read', { for: 'select', using: rlsAssignment(t.offerId) }),
    pgPolicy('messages_participant_send', {
      for: 'insert',
      withCheck: sql`${t.senderId}=${rlsActor} AND ${rlsAssignment(t.offerId, true)} AND NOT EXISTS(SELECT 1 FROM public.trip_message_reports p WHERE p.offer_id=${t.offerId})`,
    }),
    pgPolicy('messages_privacy_read', { for: 'select', using: rlsStaff('privacy.read') }),
    pgPolicy('messages_cleanup_read', {
      for: 'select',
      using: sql`${rlsStaff('privacy.cleanup')} AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${t.senderId} AND u.disabled=true)`,
    }),
    pgPolicy('messages_cleanup_delete', {
      for: 'delete',
      using: sql`${rlsStaff('privacy.cleanup')} AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${t.senderId} AND u.disabled=true)`,
    }),
    pgPolicy('messages_notification_read', { for: 'select', using: rlsNotification(t.id, 'message') }),
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
  (t) => [
    pgPolicy('message_reads_owner', {
      for: 'all',
      using: sql`${t.ownerId}=${rlsActor} AND ${rlsAssignment(t.offerId)}`,
      withCheck: sql`${t.ownerId}=${rlsActor} AND ${rlsAssignment(t.offerId)}`,
    }),
    pgPolicy('message_reads_notification', { for: 'select', using: rlsNotification(t.offerId, 'offer') }),
    pgPolicy('message_reads_privacy', { for: 'select', using: rlsStaff('privacy.read') }),
    uniqueIndex('trip_message_reader').on(t.offerId, t.ownerId),
  ],
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
  (t) => [
    pgPolicy('message_reports_participant_read', { for: 'select', using: rlsAssignment(t.offerId) }),
    pgPolicy('message_reports_participant_insert', {
      for: 'insert',
      withCheck: sql`${t.reporterId}=${rlsActor} AND ${rlsAssignment(t.offerId)} AND EXISTS(SELECT 1 FROM public.support_requests s WHERE s.id=${t.supportId} AND s.owner_id=${rlsActor})`,
    }),
    pgPolicy('message_reports_privacy', {
      for: 'select',
      using: sql`${rlsStaff('privacy.read')} OR ${rlsStaff('privacy.cleanup')}`,
    }),
    pgPolicy('message_reports_notification', { for: 'select', using: rlsNotification(t.offerId, 'offer') }),
    uniqueIndex('trip_message_reporter').on(t.offerId, t.reporterId),
  ],
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
    withdrawnAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('deletion_owner_read', { for: 'select', using: rlsConsumer(t.ownerId) }),
    pgPolicy('deletion_owner_insert', {
      for: 'insert',
      withCheck: sql`${rlsConsumer(t.ownerId)} AND ${t.withdrawnAt} IS NULL`,
    }),
    pgPolicy('deletion_owner_withdraw', {
      for: 'update',
      using: rlsConsumer(t.ownerId),
      withCheck: sql`${rlsConsumer(t.ownerId)} AND ${t.withdrawnAt} IS NOT NULL`,
    }),
    pgPolicy('deletion_staff_read', {
      for: 'select',
      using: sql`${rlsStaff('privacy.read')} OR ${rlsStaff('privacy.close')} OR ${rlsStaff('privacy.cleanup')}`,
    }),
    pgPolicy('deletion_identity_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.id}=NULLIF(current_setting('rove.identity_request',true),'')::uuid AND EXISTS(SELECT 1 FROM public.account_closures c JOIN public.users u ON u.id=c.owner_id WHERE c.request_id=${t.id} AND c.owner_id=${t.ownerId} AND u.disabled=true)`,
    }),
    uniqueIndex('account_deletion_owner')
      .on(t.ownerId)
      .where(sql`${t.withdrawnAt} is null`),
    uniqueIndex('account_deletion_support').on(t.supportRequestId),
    check(
      'account_deletion_withdrawal_time',
      sql`${t.withdrawnAt} is null or ${t.withdrawnAt} >= ${t.createdAt}`,
    ),
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
    pgPolicy('closure_owner_read', {
      for: 'select',
      using: sql`${t.ownerId}=${rlsActor} AND current_setting('rove.actor_role',true) IN ('rider','driver')`,
    }),
    pgPolicy('closure_staff_read', {
      for: 'select',
      using: sql`${rlsStaff('privacy.read')} OR ${rlsStaff('privacy.close')} OR ${rlsStaff('privacy.cleanup')} OR ${rlsStaff('privacy.hold')} OR ${rlsStaff('privacy.release-hold')}`,
    }),
    pgPolicy('closure_staff_insert', {
      for: 'insert',
      withCheck: sql`${rlsStaff('privacy.close')} AND ${t.authorizedBy}=${rlsActor} AND ${t.identityAttemptedAt} IS NULL AND ${t.identityRemovedAt} IS NULL`,
    }),
    pgPolicy('closure_identity_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.requestId}=NULLIF(current_setting('rove.identity_request',true),'')::uuid AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${t.ownerId} AND u.disabled=true)`,
    }),
    pgPolicy('closure_identity_update', {
      for: 'update',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.requestId}=NULLIF(current_setting('rove.identity_request',true),'')::uuid AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=${t.ownerId} AND u.disabled=true)`,
      withCheck: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.requestId}=NULLIF(current_setting('rove.identity_request',true),'')::uuid`,
    }),
    pgPolicy('closure_cleanup_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND EXISTS(SELECT 1 FROM public.document_cleanup_items i JOIN public.document_cleanup_plans p ON p.id=i.plan_id WHERE i.id=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid AND p.owner_id=${t.ownerId})`,
    }),
    pgPolicy('closure_access_guard', {
      for: 'select',
      using: sql`${t.ownerId}=NULLIF(current_setting('rove.closure_guard_owner',true),'')::uuid`,
    }),
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
    pgPolicy('retention_staff_read', {
      for: 'select',
      using: sql`${rlsStaff('privacy.read')} OR ${rlsStaff('privacy.hold')} OR ${rlsStaff('privacy.release-hold')}`,
    }),
    pgPolicy('retention_staff_place', {
      for: 'insert',
      withCheck: sql`${rlsStaff('privacy.hold')} AND ${t.placedBy}=${rlsActor} AND ${t.releasedAt} IS NULL`,
    }),
    pgPolicy('retention_staff_release', {
      for: 'update',
      using: rlsStaff('privacy.release-hold'),
      withCheck: sql`${rlsStaff('privacy.release-hold')} AND ${t.releasedBy}=${rlsActor} AND ${t.releasedAt} IS NOT NULL`,
    }),
    pgPolicy('retention_guard_read', {
      for: 'select',
      using: sql`${t.ownerId}=NULLIF(current_setting('rove.retention_owner',true),'')::uuid`,
    }),
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
    notDispatchedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    pgPolicy('storage_write_actor_read', {
      for: 'select',
      using: sql`(current_setting('rove.actor_role',true)='driver' OR ${rlsStaff('privacy.read')} OR ${rlsStaff('privacy.cleanup')}) AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=${t.documentId})`,
    }),
    pgPolicy('storage_write_owner_insert', {
      for: 'insert',
      withCheck: sql`current_setting('rove.actor_role',true)='driver' AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=${t.documentId} AND d.driver_id=NULLIF(current_setting('rove.actor_id',true),'')::uuid AND d.state='reserved' AND d.expires_at>clock_timestamp()) AND ${t.settledAt} IS NULL AND ${t.notDispatchedAt} IS NULL AND ${t.objectVersion} IS NULL`,
    }),
    pgPolicy('storage_write_cleanup_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND NULLIF(current_setting('rove.cleanup_item',true),'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=${t.documentId})`,
    }),
    pgPolicy('storage_write_receipt_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.documentId}=NULLIF(current_setting('rove.write_document',true),'')::uuid AND ${t.objectKey}=current_setting('rove.write_key',true)`,
    }),
    pgPolicy('storage_write_receipt_update', {
      for: 'update',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.documentId}=NULLIF(current_setting('rove.write_document',true),'')::uuid AND ${t.objectKey}=current_setting('rove.write_key',true)`,
      withCheck: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.documentId}=NULLIF(current_setting('rove.write_document',true),'')::uuid AND ${t.objectKey}=current_setting('rove.write_key',true)`,
    }),
    index('document_storage_writes_pending')
      .on(t.documentId)
      .where(sql`${t.settledAt} is null and ${t.notDispatchedAt} is null`),
    check(
      'document_storage_write_result',
      sql`(${t.settledAt} is null and ${t.objectVersion} is null and (${t.notDispatchedAt} is null or ${t.notDispatchedAt}>=${t.startedAt})) or (${t.notDispatchedAt} is null and ${t.settledAt} is not null and ${t.settledAt}>=${t.startedAt} and ${t.objectVersion} is not null and length(${t.objectVersion}) between 1 and 1024 and ${t.objectVersion}<>'null')`,
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
    pgPolicy('cleanup_plan_staff_read', {
      for: 'select',
      using: sql`${rlsStaff('privacy.read')} OR ${rlsStaff('privacy.cleanup')}`,
    }),
    pgPolicy('cleanup_plan_staff_insert', {
      for: 'insert',
      withCheck: sql`${rlsStaff('privacy.cleanup')} AND ${t.createdBy}=${rlsActor} AND ${t.approvedAt} IS NULL`,
    }),
    pgPolicy('cleanup_plan_staff_approve', {
      for: 'update',
      using: rlsStaff('privacy.cleanup'),
      withCheck: sql`${rlsStaff('privacy.cleanup')} AND ${t.approvedBy}=${rlsActor} AND ${t.approvedAt} IS NOT NULL`,
    }),
    pgPolicy('cleanup_plan_worker_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND EXISTS(SELECT 1 FROM public.document_cleanup_items i WHERE i.plan_id=${t.id} AND i.id=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid)`,
    }),
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
    pgPolicy('cleanup_item_staff_read', {
      for: 'select',
      using: sql`${rlsStaff('privacy.read')} OR ${rlsStaff('privacy.cleanup')}`,
    }),
    pgPolicy('cleanup_item_staff_insert', {
      for: 'insert',
      withCheck: sql`${rlsStaff('privacy.cleanup')} AND ${t.attemptedAt} IS NULL AND ${t.removedAt} IS NULL`,
    }),
    pgPolicy('cleanup_item_worker_read', {
      for: 'select',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.id}=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid`,
    }),
    pgPolicy('cleanup_item_worker_update', {
      for: 'update',
      using: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.id}=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid`,
      withCheck: sql`NULLIF(current_setting('rove.actor_id',true),'') IS NULL AND ${t.id}=NULLIF(current_setting('rove.cleanup_item',true),'')::uuid`,
    }),
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
