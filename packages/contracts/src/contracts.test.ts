import { describe, expect, it } from 'vitest';
import { Coordinate, DriverOffer, Money, QuoteRequest } from './index';

describe('untrusted transport input', () => {
  it('rejects invalid geography and non-integral or negative money', () => {
    expect(Coordinate.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false);
    expect(Coordinate.safeParse({ latitude: 0, longitude: Infinity }).success).toBe(false);
    for (const amount of [-1, 1.2, Infinity])
      expect(Money.safeParse({ amount, currency: 'USD' }).success).toBe(false);
  });
  it('rejects client-injected fares', () => {
    const place = {
      id: 'place',
      label: 'Test location',
      area: 'Raleigh',
      coordinate: { latitude: 35.8, longitude: -78.6 },
    };
    expect(
      QuoteRequest.safeParse({ pickup: place, destination: place, service: 'standard', fare: 1 }).success,
    ).toBe(false);
  });
  it('rejects sensitive fields in an otherwise valid offer', () => {
    const offer = {
      id: 'offer',
      rideId: 'ride',
      expiresAt: '2026-09-07T15:00:00Z',
      pickupArea: 'Raleigh',
      destinationArea: 'Durham',
      service: 'standard',
      pickupSeconds: 180,
      tripSeconds: 900,
      distanceMeters: 5000,
      estimatedEarnings: { amount: 1200, currency: 'USD' },
    };
    expect(DriverOffer.safeParse(offer).success).toBe(true);
    for (const key of ['riderId', 'riderName', 'pickup', 'coordinate', 'payer', 'polyline']) {
      expect(DriverOffer.safeParse({ ...offer, [key]: 'sensitive' }).success).toBe(false);
    }
  });
});
