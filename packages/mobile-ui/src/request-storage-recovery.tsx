import { useRef, useState } from 'react';
import { Banner, Button, Card, Copy } from './index';

/** Reading a saved request never authorizes replaying it. */
export function RequestStorageRecovery({
  error,
  onRetry,
  onSupport,
}: {
  error: string;
  onRetry: () => Promise<void>;
  onSupport: () => void;
}) {
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  async function retry() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      await onRetry();
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }
  return (
    <Card>
      <Copy kind="heading">Check your previous request</Copy>
      <Copy>
        Retry reading your saved request before updating the trip. A recovered action still needs your
        confirmation.
      </Copy>
      <Banner error message={error} />
      <Button title="Retry reading request" loading={loading} onPress={() => void retry()} />
      <Button title="Contact support" variant="secondary" onPress={onSupport} />
    </Card>
  );
}
