import { expect, test } from 'vitest';
import type { z } from 'zod';
import type { DriverDocumentSummary } from '@rove/contracts';
import { documentDetail, payoutDetail } from './status-summary';
type Document = z.infer<typeof DriverDocumentSummary>;
function document(overrides: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'driver_license',
    state: 'quarantined',
    verification: 'awaiting_review',
    createdAt: '2026-09-01T00:00:00Z',
    expiresAt: '2026-09-01T00:15:00Z',
    ...overrides,
  };
}
test('a replacement removes the superseded document warning regardless of response ordering', () => {
  const rejected = document({ verification: 'replacement_required' });
  const replacement = document({ createdAt: '2026-09-02T00:00:00Z' });
  expect(documentDetail([replacement, rejected])).toEqual({ text: 'Add documents' });
  expect(documentDetail([rejected, replacement])).toEqual({ text: 'Add documents' });
});
test('reports current review expiry rather than mistaking upload reservation expiry for credential expiry', () => {
  const expired = document({
    review: {
      status: 'expired',
      reason: null,
      expiresAt: '2026-08-31T00:00:00Z',
      reviewedAt: '2026-08-01T00:00:00Z',
    },
  });
  expect(documentDetail([expired])).toEqual({ text: '1 needs attention', attention: true });
  expect(documentDetail([document()]).attention).toBeUndefined();
});
test('does not label an incomplete upload as review pending or a subset of documents as reviewed', () => {
  expect(documentDetail([document({ state: 'reserved' })])).toEqual({
    text: 'Finish upload',
    attention: true,
  });
  expect(documentDetail([])).toEqual({ text: 'Add documents' });
  const approved = document({
    review: {
      status: 'approved',
      reason: null,
      expiresAt: '2030-01-01T00:00:00Z',
      reviewedAt: '2026-09-01T00:00:00Z',
    },
  });
  expect(documentDetail([approved])).toEqual({ text: 'Add documents' });
  expect(
    documentDetail([
      approved,
      { ...approved, kind: 'vehicle_registration' },
      { ...approved, kind: 'vehicle_insurance' },
    ]),
  ).toEqual({ text: 'Reviewed' });
});
test('payout readiness describes details, not a bank balance or sent payout', () => {
  expect(payoutDetail('ready').text).toBe('Details ready');
  expect(payoutDetail('needs_information')).toEqual({ text: 'Action needed', attention: true });
});

test('warns before reviewed credential expiry, using only the latest document per kind', () => {
  const now = Date.parse('2026-09-12T00:00:00Z');
  const approved = document({
    review: {
      status: 'approved',
      reason: null,
      reviewedAt: '2026-09-01T00:00:00Z',
      expiresAt: '2026-10-12T00:00:00Z',
    },
  });
  expect(documentDetail([approved], now)).toEqual({ text: '1 expiring soon', attention: true });
  expect(documentDetail([approved, { ...approved, kind: 'vehicle_insurance' }], now)).toEqual({
    text: '2 expiring soon',
    attention: true,
  });
  const replacement = document({ createdAt: '2026-09-12T00:00:00Z' });
  expect(documentDetail([approved, replacement], now)).toEqual({ text: 'Add documents' });
  expect(
    documentDetail(
      [{ ...approved, review: { ...approved.review!, expiresAt: '2026-09-12T00:00:00Z' } }],
      now,
    ),
  ).toEqual({ text: '1 needs attention', attention: true });
  expect(
    documentDetail(
      [{ ...approved, review: { ...approved.review!, expiresAt: '2026-10-12T00:00:01Z' } }],
      now,
    ),
  ).toEqual({ text: 'Add documents' });
  expect(documentDetail([document({ expiresAt: '2026-09-13T00:00:00Z' })], now)).toEqual({
    text: 'Add documents',
  });
});
