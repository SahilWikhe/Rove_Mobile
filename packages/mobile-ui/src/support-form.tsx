import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Banner, Button, Card, Copy, Field, Screen } from './index';
type DeletionRequest = { id: string; supportRequestId: string };
type Category = 'account' | 'vehicle' | 'trip' | 'payment' | 'other';
type Request = {
  id: string;
  category: Category;
  message: string;
  status: 'open' | 'resolved';
  response?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
};
const deletionMessage =
  'Please delete my Rove account and personal data. Contact me about any outstanding trips, payments or records that must be retained.';
const categories: Category[] = ['account', 'vehicle', 'trip', 'payment', 'other'];
/** Mount with account-ID key. Messages are held only in screen memory, never analytics. */
export function SupportForm({
  list,
  submit,
  newKey,
  accountDeletion = false,
  initialDraft,
}: {
  list: () => Promise<{
    requests: Request[];
    deletionRequest?: DeletionRequest | null;
  }>;
  submit: (
    input: { category: Category; message: string; deletionConsent?: 'account-deletion-v1' },
    key: string,
  ) => Promise<Request>;
  newKey: () => string;
  accountDeletion?: boolean;
  initialDraft?: { category: Category; message: string };
}) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [category, setCategory] = useState<Category>(initialDraft?.category ?? 'account');
  const [message, setMessage] = useState(accountDeletion ? deletionMessage : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [deletionRequest, setDeletionRequest] = useState<DeletionRequest | null>(null);
  const deletionReceived = accountDeletion && Boolean(receipt || deletionRequest);
  const mounted = useRef(true),
    running = useRef(false);
  const attempt = useRef<{ category: Category; message: string; key: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    running.current = true;
    setBusy(true);
    void list()
      .then((result) => {
        if (current) {
          setRequests(result.requests);
          setDeletionRequest(result.deletionRequest ?? null);
          setLoaded(true);
        }
      })
      .catch((failure) => {
        if (current) setError(failure instanceof Error ? failure.message : 'Unable to load your requests.');
      })
      .finally(() => {
        if (current) {
          running.current = false;
          setBusy(false);
        }
      });
    return () => {
      current = false;
    };
  }, [list]);
  async function run(send: boolean) {
    if (running.current || (send && deletionReceived)) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      if (send) {
        const text = [initialDraft?.message.trim(), message.trim()].filter(Boolean).join(' · ');
        if (!attempt.current || attempt.current.message !== text || attempt.current.category !== category)
          attempt.current = { category, message: text, key: newKey() };
        const result = await submit(
          {
            category: attempt.current.category,
            message: attempt.current.message,
            ...(accountDeletion ? { deletionConsent: 'account-deletion-v1' as const } : {}),
          },
          attempt.current.key,
        );
        if (!mounted.current) return;
        setReceipt(result.id);
        setMessage('');
        attempt.current = null;
      }
      const result = await list();
      if (mounted.current) {
        setRequests(result.requests);
        setDeletionRequest(result.deletionRequest ?? null);
        setLoaded(true);
      }
    } catch (failure) {
      if (mounted.current && accountDeletion && !send) setLoaded(false);
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Unable to load or save your request. Reload your requests before trying again.',
        );
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Screen underHeader refreshing={busy} onRefresh={() => void run(false)}>
      <Copy kind="title">{accountDeletion ? 'Request account deletion' : 'How can we help?'}</Copy>
      {accountDeletion ? (
        <>
          <Copy>Send a request to delete your Rove account and personal data.</Copy>
          <Copy kind="muted">
            Your account remains active while the request is reviewed. This does not cancel an active trip or
            change a payment. Finish or cancel outstanding trips through the trip screen.
          </Copy>
          <Copy kind="muted">
            Outstanding payments and driver earnings need to be resolved. Some transaction or safety records
            may need to be retained; support will explain the outcome in your request.
          </Copy>
        </>
      ) : (
        <>
          <Copy>
            For immediate danger, contact local emergency services. Support requests are not an emergency
            channel.
          </Copy>
          <Copy kind="muted">Do not include payment card numbers, passwords or medical details.</Copy>
        </>
      )}
      {initialDraft?.message && <Copy kind="muted">{initialDraft.message.trim()}</Copy>}
      {error && <Banner error message={error} />}
      {receipt && <Banner message={`Request saved. Reference: ${receipt}`} />}
      {!loaded && busy && <Copy kind="muted">Loading your requests…</Copy>}
      {Platform.OS === 'web' && (
        <Button
          title="Load / refresh my requests"
          variant="secondary"
          loading={busy}
          onPress={() => void run(false)}
        />
      )}
      {loaded && (
        <>
          <Copy kind="heading">
            {deletionReceived
              ? 'Deletion request received'
              : accountDeletion
                ? 'Confirm your request'
                : 'New request'}
          </Copy>
          {!accountDeletion &&
            categories.map((value) => (
              <Button
                key={value}
                title={`${value[0]!.toUpperCase()}${value.slice(1)}${category === value ? ' · Selected' : ''}`}
                variant="secondary"
                disabled={busy}
                onPress={() => setCategory(value)}
              />
            ))}
          {accountDeletion ? (
            deletionReceived ? (
              <Card>
                <Copy>
                  Your deletion request is saved. A resolved support conversation does not mean your account
                  or retained records have been deleted.
                </Copy>
                <Copy kind="muted">Reference: {deletionRequest?.supportRequestId ?? receipt}</Copy>
              </Card>
            ) : (
              <Copy>{deletionMessage}</Copy>
            )
          ) : (
            <Field
              label="What do you need help with?"
              value={message}
              editable={!busy}
              maxLength={2000 - (initialDraft ? initialDraft.message.trim().length + 3 : 0)}
              onChangeText={setMessage}
            />
          )}
          {!accountDeletion && (
            <Copy kind="muted">At least 10 characters. Check existing requests before sending another.</Copy>
          )}
          {!deletionReceived && (
            <Button
              title={accountDeletion ? 'Send deletion request' : 'Send support request'}
              disabled={busy || message.trim().length < 10}
              onPress={() => void run(true)}
            />
          )}
          <Copy kind="heading">Recent requests</Copy>
          {!requests.length && <Copy>No requests yet.</Copy>}
          {requests.map((request) => (
            <Card key={request.id}>
              <Copy kind="heading">
                {request.category} · {request.status}
              </Copy>
              <Copy>{request.message}</Copy>
              {request.response && (
                <>
                  <Copy kind="heading">Rove support</Copy>
                  <Copy>{request.response}</Copy>
                  {request.resolvedAt && (
                    <Copy kind="muted">Resolved {new Date(request.resolvedAt).toLocaleString()}</Copy>
                  )}
                </>
              )}
              <Copy kind="muted">{new Date(request.createdAt).toLocaleString()}</Copy>
              <Copy kind="muted">Reference: {request.id}</Copy>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
