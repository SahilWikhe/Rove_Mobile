import { DomainError } from './errors';
export interface RatePolicy {
  version: string;
  baseCents: number;
  centsPerKilometer: number;
  centsPerMinute: number;
  minimumCents: number;
  driverBaseCents: number;
  driverCentsPerKilometer: number;
  driverCentsPerMinute: number;
  driverMinimumCents: number;
}
/** Synthetic development rates, never a production default or approved business offer. */
export const developmentRates: RatePolicy = {
  version: 'synthetic-v1',
  baseCents: 300,
  centsPerKilometer: 90,
  centsPerMinute: 25,
  minimumCents: 700,
  driverBaseCents: 200,
  driverCentsPerKilometer: 70,
  driverCentsPerMinute: 20,
  driverMinimumCents: 550,
};
export function priceRoute(distanceMeters: number, durationSeconds: number, rates: RatePolicy) {
  if (![distanceMeters, durationSeconds].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000)) {
    throw new DomainError('INVALID_ROUTE', 'Unable to price this route.', 422);
  }
  const fields = Object.values(rates).filter((v): v is number => typeof v === 'number');
  if (fields.length !== 8 || fields.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 1_000_000)) {
    throw new DomainError('INVALID_RATE_POLICY', 'Pricing is temporarily unavailable.', 503);
  }
  // Common denominator keeps intermediate arithmetic integral, then rounds once to cents.
  const fare = Math.max(
    rates.minimumCents,
    rates.baseCents +
      Math.round(
        (3 * distanceMeters * rates.centsPerKilometer + 50 * durationSeconds * rates.centsPerMinute) / 3000,
      ),
  );
  const driverEarnings = Math.max(
    rates.driverMinimumCents,
    rates.driverBaseCents +
      Math.round(
        (3 * distanceMeters * rates.driverCentsPerKilometer +
          50 * durationSeconds * rates.driverCentsPerMinute) /
          3000,
      ),
  );
  if (Math.max(fare, driverEarnings) > 100_000_000)
    throw new DomainError('INVALID_RATE_POLICY', 'Pricing is temporarily unavailable.', 503);
  return { fare, driverEarnings, rateVersion: rates.version };
}
