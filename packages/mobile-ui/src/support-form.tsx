import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Card, Copy, Field } from './index';
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
const categories: Category[] = ['account', 'vehicle', 'trip', 'payment', 'other'];
/** Mount with account-ID key. Messages are held only in screen memory, never analytics. */
export function SupportForm({
  list,
  submit,
  newKey,
}: {
  list: () => Promise<{ requests: Request[] }>;
  submit: (input: { category: Category; message: string }, key: string) => Promise<Request>;
  newKey: () => string;
}) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [category, setCategory] = useState<Category>('account');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const mounted = useRef(true),
    running = useRef(false);
  const attempt = useRef<{ category: Category; message: string; key: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(send: boolean) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      if (send) {
        const text = message.trim();
        if (!attempt.current || attempt.current.message !== text || attempt.current.category !== category)
          attempt.current = { category, message: text, key: newKey() };
        const result = await submit(
          { category: attempt.current.category, message: attempt.current.message },
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
        setLoaded(true);
      }
    } catch (failure) {
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
    <>
      <Copy kind="title">How can we help?</Copy>
      <Copy>
        For immediate danger, contact local emergency services. Support requests are not an emergency channel.
      </Copy>
      <Copy kind="muted">Do not include payment card numbers, passwords or medical details.</Copy>
      {error && <Banner error message={error} />}
      {receipt && <Banner message={`Request saved. Reference: ${receipt}`} />}
      <Button
        title="Load / refresh my requests"
        variant="secondary"
        loading={busy}
        onPress={() => void run(false)}
      />
      {loaded && (
        <>
          <Copy kind="heading">New request</Copy>
          {categories.map((value) => (
            <Button
              key={value}
              title={`${value[0]!.toUpperCase()}${value.slice(1)}${category === value ? ' · Selected' : ''}`}
              variant="secondary"
              disabled={busy}
              onPress={() => setCategory(value)}
            />
          ))}
          <Field
            label="What do you need help with?"
            value={message}
            editable={!busy}
            maxLength={2000}
            onChangeText={setMessage}
          />
          <Copy kind="muted">At least 10 characters. Check existing requests before sending another.</Copy>
          <Button
            title="Send support request"
            disabled={busy || message.trim().length < 10}
            onPress={() => void run(true)}
          />
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
    </>
  );
}
