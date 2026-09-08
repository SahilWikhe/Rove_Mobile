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
export const RideDetails = RideSummary.extend({
  pickupArea: z.string(),
  destinationArea: z.string(),
  createdAt: z.iso.datetime(),
  pickup: Place.optional(),
  destination: Place.optional(),
  driver: z.object({ name: z.string(), vehicle: z.unknown().optional() }).optional(),
  rider: z.object({ name: z.string() }).optional(),
});
export type Profile = z.infer<typeof Profile>;
export type RideSummary = z.infer<typeof RideSummary>;
export type RideDetails = z.infer<typeof RideDetails>;
export const DriverProfile = z.object({
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
    clientSecret: z
      .string()
      .regex(/^pi_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+$/)
      .max(512),
  })
  .strict();
export type PaymentSession = z.infer<typeof PaymentSession>;
