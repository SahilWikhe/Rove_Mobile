import type { z } from 'zod';
import type { DriverDocumentSummary, DriverPayoutStatus, VehicleReview } from '@rove/contracts';

export type AccountDetail = { text: string; attention?: boolean };
export function vehicleDetail(submission: VehicleReview | null): AccountDetail {
  if (!submission) return { text: 'Add vehicle' };
  const vehicle = `${submission.vehicle.make} ${submission.vehicle.model}`;
  if (submission.status === 'rejected') return { text: `${vehicle} · Needs changes`, attention: true };
  if (submission.status === 'pending') return { text: `${vehicle} · In review` };
  return { text: `${vehicle} · ${submission.vehicle.plate}` };
}
export function payoutDetail(status: DriverPayoutStatus['status']): AccountDetail {
  return {
    text: {
      unavailable: 'Unavailable',
      not_started: 'Set up',
      pending: 'In review',
      needs_information: 'Action needed',
      ready: 'Details ready',
    }[status],
    attention: status === 'needs_information',
  };
}
export function documentDetail(documents: z.infer<typeof DriverDocumentSummary>[]): AccountDetail {
  const latest = new Map<string, z.infer<typeof DriverDocumentSummary>>();
  for (const document of documents) {
    const previous = latest.get(document.kind);
    if (!previous || document.createdAt > previous.createdAt) latest.set(document.kind, document);
  }
  const current = [...latest.values()];
  const needsAttention = current.filter(
    (document) =>
      document.state === 'expired' ||
      document.review?.status === 'expired' ||
      document.review?.status === 'rejected' ||
      document.verification === 'replacement_required' ||
      document.verification === 'delayed',
  ).length;
  if (needsAttention)
    return {
      text: `${needsAttention} ${needsAttention === 1 ? 'needs' : 'need'} attention`,
      attention: true,
    };
  if (current.some((document) => document.state === 'reserved'))
    return { text: 'Finish upload', attention: true };
  if (current.length < 3) return { text: 'Add documents' };
  if (current.every((document) => document.state === 'quarantined' && document.review?.status === 'approved'))
    return { text: 'Reviewed' };
  return { text: 'Review pending' };
}
