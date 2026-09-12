import { z } from 'zod';

export const Coordinate = z
  .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
  .strict();
export const Place = z
  .object({
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    area: z.string().min(1).max(100),
    coordinate: Coordinate,
  })
  .strict();
export const Money = z
  .object({ amount: z.number().int().nonnegative().max(100_000_000), currency: z.literal('USD') })
  .strict();
export const RideState = z.enum([
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
export const Service = z.enum(['standard', 'accessible']);
export const QuoteRequest = z.object({ pickup: Place, destination: Place, service: Service }).strict();
export const Quote = z
  .object({
    id: z.string(),
    riderId: z.string(),
    pickup: Place,
    destination: Place,
    service: Service,
    distanceMeters: z.number().int().nonnegative(),
    durationSeconds: z.number().int().nonnegative(),
    fare: Money,
    estimatedDriverEarnings: Money,
    rateVersion: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
// Deliberately contains no Place, rider identity, payer or route geometry.
export const DriverOffer = z
  .object({
    id: z.string(),
    rideId: z.string(),
    expiresAt: z.iso.datetime(),
    pickupArea: z.string(),
    destinationArea: z.string(),
    service: Service,
    pickupSeconds: z.number().int().nonnegative(),
    tripSeconds: z.number().int().nonnegative(),
    distanceMeters: z.number().int().nonnegative(),
    estimatedEarnings: Money,
  })
  .strict();
export const Capabilities = z
  .object({
    version: z.literal(1),
    scheduleCreate: z.boolean(),
    scheduleWeekly: z.boolean(),
    scheduleMonthly: z.boolean(),
    evaluatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type Coordinate = z.infer<typeof Coordinate>;
export type Place = z.infer<typeof Place>;
export type Quote = z.infer<typeof Quote>;
export type DriverOffer = z.infer<typeof DriverOffer>;
export type RideState = z.infer<typeof RideState>;
export type Service = z.infer<typeof Service>;
export type Capabilities = z.infer<typeof Capabilities>;

export const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}]+$/u, 'Use a name without control characters.');
export const ProfileNameUpdate = z
  .object({
    expectedProfileId: z.uuid(),
    expectedName: z.string().min(1).max(100),
    name: DisplayName,
  })
  .strict();
export const Profile = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.enum(['rider', 'driver', 'staff']),
});
export const RideSummary = z.object({
  id: z.uuid(),
  state: RideState,
  version: z.number().int().positive(),
  fare: Money,
  paymentState: z.string(),
});
const VehicleText = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}]+$/u);
/** Public identification of the effective assigned vehicle; excludes driver documents and review data. */
export const RideVehicle = z
  .object({
    make: VehicleText,
    model: VehicleText,
    color: VehicleText,
    plate: VehicleText,
  })
  .strict();
export type RideVehicle = z.infer<typeof RideVehicle>;
export const RideDetails = RideSummary.extend({
  pickupArea: z.string(),
  destinationArea: z.string(),
  createdAt: z.iso.datetime(),
  pickup: Place.optional(),
  destination: Place.optional(),
  driver: z.object({ name: z.string(), vehicle: RideVehicle.optional() }).optional(),
  rider: z.object({ name: z.string() }).optional(),
});
export type Profile = z.infer<typeof Profile>;
export type RideSummary = z.infer<typeof RideSummary>;
export type RideDetails = z.infer<typeof RideDetails>;
export const RideDriverLocation = z
  .object({
    rideId: z.uuid(),
    location: z
      .object({
        coordinate: Coordinate,
        sampledAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        validForMs: z.number().int().positive().max(60000),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type RideDriverLocation = z.infer<typeof RideDriverLocation>;

export const DriverCoverage = z.object({ radiusMiles: z.number().int().min(1).max(100) }).strict();

export const DriverProfile = z.object({
  coverageRadiusMiles: z.number().int().min(1).max(100).default(25),
  eligibilityStatus: z.enum(['review_required', 'expired', 'payout_required', 'eligible']).optional(),
  approved: z.boolean(),
  online: z.boolean(),
  payoutReady: z.boolean(),
  eligible: z.boolean(),
  locationAt: z.iso.datetime().nullable(),
  locationSequence: z.number().int().nonnegative(),
  vehicle: z.unknown(),
  service: Service,
});
export const Heartbeat = z
  .object({
    coordinate: Coordinate,
    sequence: z.number().int().positive(),
    sampledAt: z.iso.datetime(),
    accuracyMeters: z.number().min(0).max(100),
  })
  .strict();
export type DriverProfile = z.infer<typeof DriverProfile>;

// A location-only credential is separate from the account's OIDC access/refresh tokens.
export const TrackingGrant = z
  .object({
    token: z.string().regex(/^rt_[A-Za-z0-9_-]{43}$/),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const BackgroundLocation = Heartbeat.omit({ sequence: true });
export type TrackingGrant = z.infer<typeof TrackingGrant>;
export type BackgroundLocation = z.infer<typeof BackgroundLocation>;

// Sensitive, short-lived response for the owning rider's native payment UI; never persist it.
export const PaymentSession = z
  .object({
    rideId: z.uuid(),
    customer: z
      .object({
        customerId: z.string().regex(/^cus_[a-zA-Z0-9]{1,96}$/),
        clientSecret: z.string().min(1).max(1024),
      })
      .strict()
      .optional(),
    clientSecret: z
      .string()
      .regex(/^pi_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+$/)
      .max(512),
  })
  .strict();
export type PaymentSession = z.infer<typeof PaymentSession>;

export const ReceiptRefunds = z
  .object({
    verifiedAt: z.iso.datetime().nullable(),
    items: z
      .array(
        z
          .object({
            id: z.string().regex(/^re_[a-zA-Z0-9]{1,96}$/),
            amount: Money,
            status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
            createdAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export const RideReceipt = z
  .object({
    id: z.uuid(),
    rideId: z.uuid(),
    recordedAt: z.iso.datetime(),
    quotedFare: Money,
    capturedAmount: Money,
    refunds: ReceiptRefunds.optional(),
    rideState: RideState,
    paymentState: z.string().min(1).max(100),
  })
  .strict();
export type RideReceipt = z.infer<typeof RideReceipt>;

const EarningsValue = z
  .object({
    amount: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    currency: z.literal('USD'),
  })
  .strict();
export const DriverTripEarnings = z
  .object({
    rideId: z.uuid(),
    estimatedAmount: Money,
    adjustmentAmount: EarningsValue.optional(),
    refundAdjustmentAmount: EarningsValue.optional(),
    disputeAdjustmentAmount: EarningsValue.optional(),
    netRecordedAmount: EarningsValue.nullable().optional(),
    recordedAmount: Money.nullable(),
    recordedAt: z.iso.datetime().nullable(),
    payoutStatus: z.literal('not_configured'),
  })
  .strict()
  .refine((v) => {
    const details = [
      v.adjustmentAmount,
      v.refundAdjustmentAmount,
      v.disputeAdjustmentAmount,
      v.netRecordedAmount,
    ];
    if (details.every((value) => value === undefined)) return true;
    if (
      !v.adjustmentAmount ||
      !v.refundAdjustmentAmount ||
      !v.disputeAdjustmentAmount ||
      v.netRecordedAmount === undefined
    )
      return false;
    return (
      v.adjustmentAmount.amount === v.refundAdjustmentAmount.amount + v.disputeAdjustmentAmount.amount &&
      (v.recordedAmount === null
        ? v.netRecordedAmount === null
        : v.netRecordedAmount !== null &&
          v.netRecordedAmount.amount === v.recordedAmount.amount + v.adjustmentAmount.amount)
    );
  }, 'Earnings adjustment details are incomplete or inconsistent.');
export type DriverTripEarnings = z.infer<typeof DriverTripEarnings>;

export const EarningsDateRange = z
  .object({ from: z.iso.date(), through: z.iso.date() })
  .strict()
  .refine((range) => range.from <= range.through, 'Start date must not follow end date.');
export type EarningsDateRange = z.infer<typeof EarningsDateRange>;

export const DriverEarnings = z
  .object({
    adjustmentTotal: EarningsValue.optional(),
    netTotal: EarningsValue.optional(),
    periodAdjustmentTotal: EarningsValue.optional(),
    periodNetTotal: EarningsValue.optional(),
    recordedTotal: z
      .object({
        amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        currency: z.literal('USD'),
      })
      .strict(),
    periodTotal: z
      .object({
        amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        currency: z.literal('USD'),
      })
      .strict()
      .optional(),
    dailyTotals: z
      .array(
        z
          .object({ date: z.iso.date(), amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
          .strict(),
      )
      .max(31)
      .optional(),
    entries: z
      .array(
        z
          .object({
            id: z.uuid(),
            rideId: z.uuid(),
            recordedAt: z.iso.datetime(),
            amount: EarningsValue,
            kind: z.enum(['allocation', 'refund_loss_allocation', 'dispute_loss_allocation']).optional(),
          })
          .strict(),
      )
      .max(50),
    hasMore: z.boolean(),
    nextCursor: z.uuid().nullable(),
    payoutStatus: z.literal('not_configured'),
  })
  .strict()
  .refine((v) => {
    const details = [v.adjustmentTotal, v.netTotal, v.periodAdjustmentTotal, v.periodNetTotal];
    if (details.every((value) => value === undefined))
      return v.entries.every((e) => e.kind === undefined && e.amount.amount >= 0);
    if (
      !v.adjustmentTotal ||
      !v.netTotal ||
      v.entries.some((e) => !e.kind || (e.kind === 'allocation' && e.amount.amount < 0))
    )
      return false;
    if (v.netTotal.amount !== v.recordedTotal.amount + v.adjustmentTotal.amount) return false;
    return v.periodTotal
      ? !!v.periodAdjustmentTotal &&
          !!v.periodNetTotal &&
          v.periodNetTotal.amount === v.periodTotal.amount + v.periodAdjustmentTotal.amount
      : !v.periodAdjustmentTotal && !v.periodNetTotal;
  }, 'Earnings adjustment totals are incomplete or inconsistent.');
export type DriverEarnings = z.infer<typeof DriverEarnings>;

export const SavedPlaceKind = z.enum(['home', 'work']);
export type SavedPlaceKind = z.infer<typeof SavedPlaceKind>;
export const SavedPlace = z.object({ kind: SavedPlaceKind, placeId: z.string().min(1).max(512) }).strict();
export const SavedPlaces = z.object({ places: z.array(SavedPlace).max(2) }).strict();
export const SavedPlaceUpdate = z
  .object({
    placeId: z.string().trim().min(1).max(512),
    expectedPlaceId: z.string().min(1).max(512).nullable(),
  })
  .strict();
export const SavedPlaceDelete = z.object({ expectedPlaceId: z.string().min(1).max(512) }).strict();

export const VehicleSubmission = z
  .object({
    make: VehicleText,
    model: VehicleText,
    year: z.number().int().min(1900).max(2100),
    color: VehicleText,
    plate: VehicleText,
    registrationRegion: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/),
    requestedService: Service,
  })
  .strict();
export type VehicleSubmission = z.infer<typeof VehicleSubmission>;
export const VehicleSubmissionUpdate = z
  .object({ vehicle: VehicleSubmission, expectedRevision: z.uuid().nullable() })
  .strict();
export const VehicleCorrection = z.enum([
  'vehicle_details_mismatch',
  'registration_not_verified',
  'vehicle_not_eligible',
  'accessibility_not_verified',
]);
export type VehicleCorrection = z.infer<typeof VehicleCorrection>;
export const VehicleCorrections = z
  .array(VehicleCorrection)
  .max(4)
  .refine((values) => new Set(values).size === values.length, 'Correction categories must be unique.');
export const VehicleReview = z
  .object({
    revision: z.uuid(),
    vehicle: VehicleSubmission,
    status: z.enum(['pending', 'approved', 'rejected']),
    corrections: VehicleCorrections.default([]),
    submittedAt: z.iso.datetime(),
  })
  .strict();
export const VehicleReviewResponse = z.object({ submission: VehicleReview.nullable() }).strict();

export type VehicleReview = z.infer<typeof VehicleReview>;

export const VehicleReviewDecision = z
  .object({
    revision: z.uuid(),
    decision: z.enum(['approved', 'rejected']),
    reason: z
      .string()
      .trim()
      .min(10)
      .max(1000)
      .regex(/^[^\p{Cc}]+$/u),
    verifiedService: Service.optional(),
    corrections: VehicleCorrections.default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.decision === 'rejected') !== value.corrections.length > 0)
      ctx.addIssue({
        code: 'custom',
        message: 'Select correction categories for rejected submissions only.',
        path: ['corrections'],
      });
    if (value.decision === 'approved' && !value.verifiedService)
      ctx.addIssue({ code: 'custom', message: 'Select the verified service.', path: ['verifiedService'] });
    if (value.decision === 'rejected' && value.verifiedService)
      ctx.addIssue({
        code: 'custom',
        message: 'Rejected vehicles cannot receive service verification.',
        path: ['verifiedService'],
      });
  });

export const SupportCategory = z.enum(['account', 'vehicle', 'trip', 'payment', 'other']);
export const SupportRequestInput = z
  .object({
    category: SupportCategory,
    deletionConsent: z.literal('account-deletion-v1').optional(),
    message: z
      .string()
      .trim()
      .min(10)
      .max(2000)
      .regex(/^[^\p{Cc}\p{Cf}]*$/u),
  })
  .strict();
export const SupportResolution = z
  .object({
    response: SupportRequestInput.shape.message,
  })
  .strict();
export const SupportRequest = z
  .object({
    id: z.uuid(),
    category: SupportCategory,
    message: z.string(),
    status: z.enum(['open', 'resolved']),
    response: z.string().nullable().default(null),
    resolvedAt: z.iso.datetime().nullable().default(null),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type SupportRequest = z.infer<typeof SupportRequest>;
export type SupportRequestInput = z.infer<typeof SupportRequestInput>;
export const SupportRequests = z.object({ requests: z.array(SupportRequest).max(50) }).strict();

export const SupportQueueQuery = z
  .object({
    status: z.enum(['open', 'resolved']).default('open'),
    afterCreatedAt: z.iso.datetime().optional(),
    afterId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.afterCreatedAt) === Boolean(value.afterId),
    'Both cursor fields are required.',
  );
export const SupportQueue = z
  .object({
    requests: z
      .array(SupportRequest.pick({ id: true, category: true, status: true, createdAt: true }))
      .max(50),
    nextCursor: z.object({ afterCreatedAt: z.iso.datetime(), afterId: z.uuid() }).strict().nullable(),
  })
  .strict();

export const DriverPayoutStatus = z
  .object({
    status: z.enum(['unavailable', 'not_started', 'pending', 'needs_information', 'ready']),
  })
  .strict();
export type DriverPayoutStatus = z.infer<typeof DriverPayoutStatus>;
export const DriverPayoutLink = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.port &&
          ['accounts.stripe.com', 'connect.stripe.com'].includes(url.hostname)
        );
      }),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type DriverPayoutLink = z.infer<typeof DriverPayoutLink>;

export const PushInstallationProof = z
  .object({
    installationId: z.uuid(),
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const PushInstallationUpdate = PushInstallationProof.extend({
  mutationId: z.uuid(),
  expectedRevision: z.number().int().positive().nullable(),
  token: z
    .string()
    .max(256)
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
  platform: z.enum(['ios', 'android']),
}).strict();
export const PushInstallationDelete = PushInstallationProof.extend({
  mutationId: z.uuid(),
  expectedRevision: z.number().int().positive(),
}).strict();
export const PushInstallationStatus = z
  .object({
    installationId: z.uuid(),
    revision: z.number().int().positive().nullable(),
    enabled: z.boolean(),
  })
  .strict();

export const PushHint = z
  .object({
    eventId: z.uuid(),
    kind: z.enum(['ride_update', 'offer_available', 'message_available']),
    referenceId: z.uuid(),
  })
  .strict();

export const NotificationDevice = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    platform: z.enum(['ios', 'android']),
    registeredAt: z.iso.datetime(),
  })
  .strict();
export const NotificationDeviceList = z.object({ devices: z.array(NotificationDevice).max(10) }).strict();
export const NotificationDeviceRevoke = z
  .object({
    expectedRevision: z.number().int().positive(),
    mutationId: z.uuid(),
  })
  .strict();
export const NotificationDeviceRevoked = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    enabled: z.literal(false),
  })
  .strict();

export const DriverDocumentReservation = z
  .object({
    id: z.uuid(),
    kind: z.enum(['driver_license', 'vehicle_registration', 'vehicle_insurance']),
    contentType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();
export const DriverDocumentRejection = z.enum([
  'unreadable',
  'wrong_document',
  'expired',
  'details_mismatch',
]);
export const DriverDocumentReviewDecision = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approved'), expiresAt: z.iso.datetime() }).strict(),
  z.object({ decision: z.literal('rejected'), reason: DriverDocumentRejection }).strict(),
]);
export const DriverDocumentReviewResult = z
  .object({
    documentId: z.uuid(),
    status: z.enum(['approved', 'rejected', 'expired']),
    expiresAt: z.iso.datetime().nullable(),
    reason: DriverDocumentRejection.nullable(),
    reviewedAt: z.iso.datetime(),
  })
  .strict();

export const DriverDocumentSummary = z
  .object({
    id: z.uuid(),
    kind: DriverDocumentReservation.shape.kind,
    state: z.enum(['reserved', 'quarantined', 'expired']),
    // Optional so an updated app can still read summaries from an older staging API.
    verification: z.enum(['pending', 'awaiting_review', 'replacement_required', 'delayed']).optional(),
    review: DriverDocumentReviewResult.omit({ documentId: true }).optional(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const DriverDocumentList = z.object({ documents: z.array(DriverDocumentSummary).max(30) }).strict();

export const DriverDocumentUploadTarget = z
  .object({
    documentId: z.uuid(),
    key: z.string().max(300),
    url: z.url({ protocol: /^https$/ }),
    fields: z.record(z.string().max(100), z.string().max(10000)),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const DriverDocumentUploadCompletion = z.object({ key: z.string().max(300) }).strict();

// Short-lived Stripe settings credentials. Keep in memory only.
export const WalletSetupRequest = z.object({ requestId: z.uuid() }).strict();
export const WalletCustomerSession = z
  .object({
    customerId: z.string().regex(/^cus_[a-zA-Z0-9]{1,96}$/),
    clientSecret: z.string().min(1).max(1024),
  })
  .strict();
export const WalletSetupSession = z
  .object({
    clientSecret: z
      .string()
      .regex(/^seti_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+$/)
      .max(1024),
  })
  .strict();

// Assignment-scoped text messaging. No contact details or client-selected recipients.
export const MessageInput = z
  .object({
    requestId: z.uuid(),
    text: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine((value) =>
        Array.from(value).every(
          (char) => char.charCodeAt(0) >= 32 || char === '\n' || char === '\r' || char === '\t',
        ),
      ),
  })
  .strict();
export const TripMessage = z
  .object({
    id: z.uuid(),
    sequence: z.number().int().positive(),
    mine: z.boolean(),
    text: z.string().min(1).max(1000),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type TripMessage = z.infer<typeof TripMessage>;
export const Conversation = z
  .object({
    id: z.uuid(),
    rideId: z.uuid(),
    name: z.string(),
    rideCreatedAt: z.iso.datetime(),
    state: RideState,
    canSend: z.boolean(),
    blocked: z.boolean(),
    unread: z.number().int().nonnegative(),
    latest: TripMessage.nullable(),
  })
  .strict();
export type Conversation = z.infer<typeof Conversation>;
export const ConversationQuery = z
  .object({
    beforeCreatedAt: z.iso.datetime().optional(),
    beforeId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.beforeCreatedAt) === Boolean(v.beforeId));
export const ConversationList = z
  .object({
    conversations: z.array(Conversation).max(50),
    nextCursor: z.object({ beforeCreatedAt: z.iso.datetime(), beforeId: z.uuid() }).strict().nullable(),
  })
  .strict();
export type ConversationList = z.infer<typeof ConversationList>;
export const ConversationThread = z
  .object({ conversation: Conversation, messages: z.array(TripMessage).max(200) })
  .strict();
export type ConversationThread = z.infer<typeof ConversationThread>;
export const MessageRead = z.object({ through: z.number().int().positive() }).strict();
export const MessageReport = z.object({ reason: z.enum(['harassment', 'unsafe', 'spam', 'other']) }).strict();

export const RefundAuthorization = z
  .object({
    amountCents: z.number().int().min(1).max(99_999_999),
    reason: z.enum(['customer_request', 'service_issue', 'duplicate_payment']),
    policyReference: z.string().trim().min(1).max(128),
  })
  .strict();
export const RefundOperation = z
  .object({
    id: z.uuid(),
    state: z.enum(['queued', 'submitted', 'review_required']),
    amountCents: z.number().int().positive(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const DisputeStatus = z.enum([
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented',
]);
export const StaffDisputeQueue = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().regex(/^(du|dp)_[a-zA-Z0-9]{1,96}$/),
            rideId: z.uuid(),
            amount: Money,
            status: DisputeStatus,
            reason: z.string().max(64),
            dueAt: z.iso.datetime().nullable(),
            verifiedAt: z.iso.datetime(),
            settlementBlocked: z.boolean(),
          })
          .strict(),
      )
      .max(50),
    nextCursor: z.string().nullable(),
  })
  .strict();

// Signed allocation amounts restore prior deductions when verified funds are returned.
const SignedFinancialCents = z.number().int().min(-99_999_999).max(99_999_999);
export const PaymentLossAuthorization = z
  .object({
    kind: z.enum(['refund', 'dispute']),
    expectedBalanceCents: SignedFinancialCents.refine((n) => n !== 0),
    riderFundsCents: SignedFinancialCents,
    driverCents: SignedFinancialCents,
    platformCents: SignedFinancialCents,
    policyReference: z.string().trim().min(1).max(128),
  })
  .strict()
  .refine(
    (v) => v.riderFundsCents + v.driverCents + v.platformCents === v.expectedBalanceCents,
    'Allocate the entire verified outstanding balance.',
  )
  .refine(
    (v) =>
      [v.riderFundsCents, v.driverCents, v.platformCents].every(
        (n) => n === 0 || Math.sign(n) === Math.sign(v.expectedBalanceCents),
      ),
    'Allocations must follow the direction of the verified balance.',
  );
export const PaymentLossReview = z
  .object({
    allocatedLosses: z
      .array(
        z
          .object({
            kind: z.enum(['refund', 'dispute']),
            riderFundsCents: SignedFinancialCents,
            driverCents: SignedFinancialCents,
            platformCents: SignedFinancialCents,
          })
          .strict(),
      )
      .length(2),
    rideId: z.uuid(),
    refundBalanceCents: SignedFinancialCents,
    disputeBalanceCents: SignedFinancialCents,
    riderFundsCents: SignedFinancialCents,
    driverPayableCents: SignedFinancialCents,
    verifiedRecordsCurrent: z.boolean(),
  })
  .strict();

export const DriverTransferAuthorization = z
  .object({
    amountCents: z.number().int().min(1).max(99_999_999),
    policyReference: z.string().trim().min(1).max(128),
  })
  .strict();
export const DriverTransferOperation = z
  .object({
    id: z.uuid(),
    state: z.enum(['queued', 'confirmed', 'review_required', 'canceled']),
    amountCents: z.number().int().min(1).max(99_999_999),
    reversedCents: z.number().int().min(0).max(99_999_999),
    createdAt: z.iso.datetime(),
    checkedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine((o) => o.reversedCents <= o.amountCents);

export const BankPayoutCursor = z.string().regex(/^po_[a-zA-Z0-9]{1,96}$/);
export const BankPayout = z
  .object({
    id: BankPayoutCursor,
    amountCents: z.number().int().min(1).max(99_999_999),
    currency: z.literal('usd'),
    status: z.enum(['pending', 'in_transit', 'paid', 'failed', 'canceled']),
    createdAt: z.iso.datetime(),
    expectedArrivalAt: z.iso.datetime(),
    destinationType: z.enum(['bank_account', 'card']),
  })
  .strict();
export const BankPayoutHistory = z
  .object({
    status: z.enum(['unavailable', 'not_started', 'available']),
    items: z.array(BankPayout).max(20),
    nextCursor: BankPayoutCursor.nullable(),
    checkedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine((p) =>
    p.status === 'available'
      ? p.checkedAt !== null &&
        new Set(p.items.map((i) => i.id)).size === p.items.length &&
        (p.nextCursor === null || p.items.at(-1)?.id === p.nextCursor)
      : p.items.length === 0 && p.nextCursor === null && p.checkedAt === null,
  );
export type BankPayoutHistory = z.infer<typeof BankPayoutHistory>;
export type BankPayout = z.infer<typeof BankPayout>;

export const AccountDeletionRequest = z
  .object({
    id: z.uuid(),
    supportRequestId: z.uuid(),
    consentVersion: z.literal('account-deletion-v1'),
    state: z.literal('requested'),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const AccountDeletionStatus = z.object({ request: AccountDeletionRequest.nullable() }).strict();
