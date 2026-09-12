import type { DriverActivity } from '@rove/contracts';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@rove/mobile-core/session';
import { documentDetail, payoutDetail, vehicleDetail, type AccountDetail } from './status-summary';

type Details = {
  activity: DriverActivity | null;
  vehicle: AccountDetail;
  documents: AccountDetail;
  payout: AccountDetail;
};
const loading: Details = {
  activity: null,
  vehicle: { text: 'Checking…' },
  documents: { text: 'Checking…' },
  payout: { text: 'Checking…' },
};
export function useAccountDetails() {
  const { api, profile } = useSession();
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [details, setDetails] = useState<Details>(loading);
  useFocusEffect(
    useCallback(() => {
      let current = true;
      const abort = new AbortController();
      setDetails(loading);
      setRefreshing(!!profile);
      if (profile)
        void Promise.allSettled([
          api.vehicleSubmission(),
          api.driverDocuments(abort.signal),
          api.driverPayoutStatus(abort.signal),
          api.driverActivity(abort.signal),
        ]).then(([vehicle, documents, payout, activity]) => {
          if (!current) return;
          setRefreshing(false);
          setDetails({
            activity: activity.status === 'fulfilled' ? activity.value : null,
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
    }, [api, profile?.id, revision]),
  );
  return {
    ...details,
    refreshing,
    refresh: () => {
      if (!refreshing) setRevision((value) => value + 1);
    },
  };
}
