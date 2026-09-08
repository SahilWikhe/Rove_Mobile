import type { VehicleCorrection, VehicleReview } from '@rove/contracts';
import { Card, Copy } from '@rove/mobile-ui';

const guidance: Record<VehicleCorrection, string> = {
  vehicle_details_mismatch:
    'Check the make, model, year, color and plate against your vehicle registration. Correct any differences before submitting again.',
  registration_not_verified:
    'Your registration could not be verified. Contact Rove support for the next verification step; changing the form alone will not resolve this.',
  vehicle_not_eligible:
    'This vehicle did not meet the review requirements. Contact Rove support before resubmitting, or submit a different eligible vehicle.',
  accessibility_not_verified:
    'Accessible capability could not be verified. Contact Rove support about the required evidence, or request Standard if appropriate.',
};

export function VehicleReviewStatus({ submission }: { submission: VehicleReview | null }) {
  return (
    <Card>
      <Copy kind="heading">
        {!submission
          ? 'No vehicle submitted'
          : {
              pending: 'Vehicle review pending',
              approved: 'Vehicle review approved',
              rejected: 'Your vehicle needs attention',
            }[submission.status]}
      </Copy>
      {submission?.status === 'rejected' && (
        <>
          {submission.corrections.length ? (
            submission.corrections.map((code) => <Copy key={code}>{guidance[code]}</Copy>)
          ) : (
            <Copy>Contact Rove support to understand what needs to change before submitting again.</Copy>
          )}
          <Copy kind="muted">
            A new submission starts a new review. It does not restore driving approval.
          </Copy>
        </>
      )}
      <Copy kind="muted">
        Vehicle review, document checks and payout setup must be completed before you can drive. Submitted
        details do not approve your vehicle.
      </Copy>
    </Card>
  );
}
