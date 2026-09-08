import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, text, uuid, integer, boolean, timestamp, jsonb, uniqueIndex, check } from 'drizzle-orm/pg-core';

export const rideStatus = pgEnum('ride_status', ['searching', 'matched', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_driver_found', 'no_show', 'interrupted', 'terminated']);
export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(), subject: text().notNull().unique(),
  name: text().notNull(), role: text().notNull(), disabled: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [check('valid_user_role', sql`${t.role} in ('rider', 'driver', 'staff')`)]);
export const drivers = pgTable('drivers', {
  id: uuid().primaryKey().references(() => users.id), approved: boolean().notNull().default(false),
  online: boolean().notNull().default(false), service: text().notNull().default('standard'),
  payoutReady: boolean().notNull().default(false), eligibilityExpiresAt: timestamp({ withTimezone: true }),
  locationSequence: integer().notNull().default(0),
  location: jsonb(), locationAt: timestamp({ withTimezone: true }), vehicle: jsonb(),
});
export const quotes = pgTable('quotes', {
  id: uuid().primaryKey(), riderId: uuid().notNull().references(() => users.id),
  snapshot: jsonb().notNull(), expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const rides = pgTable('rides', {
  id: uuid().primaryKey().defaultRandom(), quoteId: uuid().notNull().references(() => quotes.id).unique(),
  riderId: uuid().notNull().references(() => users.id), driverId: uuid().references(() => drivers.id),
  state: rideStatus().notNull().default('searching'), version: integer().notNull().default(1),
  fareCents: integer().notNull(), earningsCents: integer().notNull(),
  paymentState: text().notNull().default('pending'),
  searchDeadline: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  check('positive_ride_money', sql`${t.fareCents} >= 0 and ${t.earningsCents} >= 0`),
  check('positive_ride_version', sql`${t.version} > 0`),
  uniqueIndex('one_active_ride_per_rider').on(t.riderId).where(sql`${t.state} in ('searching','matched','en_route','arrived','in_progress','interrupted')`),
  uniqueIndex('one_active_ride_per_driver').on(t.driverId).where(sql`${t.state} in ('matched','en_route','arrived','in_progress','interrupted')`),
]);
export const offers = pgTable('offers', {
  id: uuid().primaryKey().defaultRandom(), rideId: uuid().notNull().references(() => rides.id),
  driverId: uuid().notNull().references(() => drivers.id), status: text().notNull().default('pending'),
  expiresAt: timestamp({ withTimezone: true }).notNull(), snapshot: jsonb().notNull(),
}, t => [
  check('valid_offer_status', sql`${t.status} in ('pending','accepted','declined','expired','revoked')`),
  uniqueIndex('one_pending_offer_per_ride').on(t.rideId).where(sql`${t.status} = 'pending'`),
  uniqueIndex('one_pending_offer_per_driver').on(t.driverId).where(sql`${t.status} = 'pending'`),
  uniqueIndex('driver_offered_once_per_ride').on(t.rideId, t.driverId),
]);
export const commands = pgTable('commands', {
  id: uuid().primaryKey().defaultRandom(), actorId: uuid().notNull().references(() => users.id),
  key: text().notNull(), fingerprint: text().notNull(), result: jsonb().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('actor_command_key').on(t.actorId, t.key)]);
export const outbox = pgTable('outbox', {
  id: uuid().primaryKey().defaultRandom(), topic: text().notNull(), aggregateId: uuid().notNull(),
  payload: jsonb().notNull(), dedupeKey: text().notNull().unique(), attempts: integer().notNull().default(0),
  availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp({ withTimezone: true }), completedAt: timestamp({ withTimezone: true }),
  leaseToken: uuid(), deadLetterAt: timestamp({ withTimezone: true }), lastErrorCode: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const audit = pgTable('audit', {
  id: uuid().primaryKey().defaultRandom(), actorId: uuid().references(() => users.id),
  action: text().notNull(), aggregateId: uuid().notNull(), metadata: jsonb().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const driverTrackingSessions = pgTable('driver_tracking_sessions', {
  driverId: uuid().primaryKey().references(() => drivers.id),
  tokenHash: text().notNull().unique(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  sampledAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
