import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from './session';
import type { Operation, PendingOperation } from './operations';
/** Recovery is user-triggered; loading a journal never submits its saved operation. */
export function useOperations() {
  const { operations, api } = useSession();
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const epoch = useRef(0);
  useEffect(() => {
    const current = ++epoch.current;
    setPending(null);
    setRecoveryError(null);
    setRestoring(true);
    if (!operations) {
      setRestoring(false);
      return;
    }
    void operations
      .then((journal) => journal.pending())
      .then((entry) => {
        if (epoch.current === current) setPending(entry);
      })
      .catch(() => {
        if (epoch.current === current)
          setRecoveryError('Previous request could not be read. Please try again or contact support.');
      })
      .finally(() => {
        if (epoch.current === current) setRestoring(false);
      });
    return () => {
      epoch.current++;
    };
  }, [operations]);
  const execute = useCallback(
    async (input: Operation) => {
      if (!operations) throw new Error('Sign in to continue.');
      const current = epoch.current;
      const journal = await operations;
      try {
        return await journal.execute(input, ({ key, operation }) =>
          operation.kind === 'book'
            ? api.book(operation.quoteId, key)
            : api.transition(operation.rideId, operation.state, operation.version, key),
        );
      } finally {
        try {
          const entry = await journal.pending();
          if (current === epoch.current) setPending(entry);
        } catch {
          if (current === epoch.current)
            setRecoveryError('Previous request could not be read. Contact support before another action.');
        }
      }
    },
    [operations, api],
  );
  return { pending, restoring, recoveryError, execute };
}
