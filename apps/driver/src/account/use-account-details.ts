import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { documentDetail, payoutDetail, vehicleDetail, type AccountDetail } from './status-summary';

type Details = { vehicle: AccountDetail; documents: AccountDetail; payout: AccountDetail };
const loading: Details = {
  vehicle: { text: 'Checking…' },
  documents: { text: 'Checking…' },
  payout: { text: 'Checking…' },
};
export function useAccountDetails() {
  const { api, profile } = useSession();
  const [details, setDetails] = useState<Details>(loading);
  useFocusEffect(
    useCallback(() => {
      let current = true;
      const abort = new AbortController();
      setDetails(loading);
      if (profile)
        void Promise.allSettled([
          api.vehicleSubmission(),
          api.driverDocuments(abort.signal),
          api.driverPayoutStatus(abort.signal),
        ]).then(([vehicle, documents, payout]) => {
          if (!current) return;
          setDetails({
            vehicle:
              vehicle.status === 'fulfilled'
                ? vehicleDetail(vehicle.value.submission)
                : { text: 'Unable to load' },
            documents:
              documents.status === 'fulfilled'
                ? documentDetail(documents.value.documents)
                : { text: 'Unable to load' },
            payout:
              payout.status === 'fulfilled' ? payoutDetail(payout.value.status) : { text: 'Unable to load' },
          });
        });
      return () => {
        current = false;
        abort.abort();
      };
    }, [api, profile?.id]),
  );
  return details;
}
