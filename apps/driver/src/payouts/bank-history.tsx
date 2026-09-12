import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { BankPayoutHistory } from '@rove/contracts';
import { useSession } from '@rove/mobile-core/session';
import { Banner, Button, Card, Copy } from '@rove/mobile-ui';
const labels = {
  pending: 'Pending',
  in_transit: 'On the way',
  paid: 'Paid by Stripe',
  failed: 'Payout failed',
  canceled: 'Canceled',
};
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
export function BankHistory({ revision }: { revision: number }) {
  const { api } = useSession();
  const [data, setData] = useState<BankPayoutHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    pending = useRef(false),
    controller = useRef<AbortController | null>(null);
  useFocusEffect(
    useCallback(() => {
      void revision;
      const generation = ++epoch.current,
        abort = new AbortController();
      controller.current = abort;
      pending.current = true;
      setBusy(true);
      setData(null);
      setError(null);
      void api
        .bankPayoutHistory(undefined, abort.signal)
        .then((result) => {
          if (epoch.current === generation) setData(result);
        })
        .catch(() => {
          if (epoch.current === generation) setError('Unable to load bank payouts. Pull down to try again.');
        })
        .finally(() => {
          if (epoch.current === generation) {
            pending.current = false;
            setBusy(false);
          }
        });
      return () => {
        epoch.current++;
        pending.current = false;
        abort.abort();
        controller.current = null;
      };
    }, [api, revision]),
  );
  async function older() {
    if (!data?.nextCursor || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const generation = epoch.current;
    try {
      const next = await api.bankPayoutHistory(data.nextCursor, controller.current?.signal);
      if (epoch.current !== generation) return;
      if (next.status !== 'available') {
        setData(next);
        return;
      }
      // Individual pages are bounded; previous loaded rows remain visible on pagination failure.
      setData((previous) =>
        previous
          ? {
              ...next,
              items: [...new Map([...previous.items, ...next.items].map((item) => [item.id, item])).values()],
            }
          : next,
      );
    } catch {
      if (epoch.current === generation) setError('Unable to load older payouts. Try again.');
    } finally {
      if (epoch.current === generation) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <Copy kind="heading">Bank payouts</Copy>
      <Copy kind="muted">
        Earnings and transfers to your Stripe balance are separate from payouts to your bank or debit card.
      </Copy>
      {error && <Banner error message={error} />}
      {!data && !error && <Copy kind="muted">Loading bank payouts…</Copy>}
      {data?.status === 'unavailable' && (
        <Card>
          <Copy>Bank payout history is not available yet.</Copy>
        </Card>
      )}
      {data?.status === 'not_started' && (
        <Card>
          <Copy>Complete your Stripe setup below to view bank payouts.</Copy>
        </Card>
      )}
      {data?.status === 'available' && (
        <>
          {data.items.length === 0 && (
            <Card>
              <Copy>No bank payouts yet.</Copy>
              <Copy kind="muted">Recorded earnings do not mean a bank payout has been sent.</Copy>
            </Card>
          )}
          {data.items.map((item) => (
            <Card key={item.id}>
              <Copy kind="heading">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                  item.amountCents / 100,
                )}
              </Copy>
              <Copy>{labels[item.status]}</Copy>
              <Copy kind="muted">
                {item.destinationType === 'card' ? 'Debit card' : 'Bank account'} · Created{' '}
                {date(item.createdAt)}
              </Copy>
              {(item.status === 'pending' || item.status === 'in_transit') && (
                <Copy>Estimated arrival {date(item.expectedArrivalAt)}</Copy>
              )}
              {item.status === 'paid' && (
                <Copy kind="muted">
                  Stripe reports this payout as paid. Your bank may take additional time to show it.
                </Copy>
              )}
              {item.status === 'failed' && (
                <Copy>Review your Stripe details below or contact support before trying again.</Copy>
              )}
              {item.status === 'canceled' && <Copy kind="muted">This payout was canceled.</Copy>}
            </Card>
          ))}
          {data.nextCursor && (
            <Button title="Older payouts" variant="secondary" loading={busy} onPress={() => void older()} />
          )}
          <Copy kind="muted">
            Dates are shown in UTC. Arrival dates are estimates; pull down to check the latest status.
          </Copy>
        </>
      )}
    </>
  );
}
