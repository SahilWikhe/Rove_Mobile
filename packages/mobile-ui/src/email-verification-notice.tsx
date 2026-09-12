import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Copy } from './index';

/** Request acceptance never marks a session verified; a fresh login must prove that. */
export function EmailVerificationNotice({
  loading,
  onSignIn,
  onResend,
}: {
  loading: boolean;
  onSignIn: () => void;
  onResend: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [result, setResult] = useState<{ message: string; error: boolean }>();
  const active = useRef(0);
  const pending = useRef(false);
  useEffect(
    () => () => {
      active.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(false), 60_000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function resend() {
    if (pending.current || loading || cooldown) return;
    pending.current = true;
    const generation = active.current;
    setBusy(true);
    setResult(undefined);
    setCooldown(true);
    try {
      await onResend();
      if (active.current === generation)
        setResult({
          error: false,
          message:
            'Email request accepted. Check your inbox and spam folder, then sign in again after verifying.',
        });
    } catch {
      if (active.current === generation)
        setResult({
          error: true,
          message:
            'We could not confirm the email request. Check your inbox, wait a minute and try again. Contact support if it still does not arrive.',
        });
    } finally {
      if (active.current === generation) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  function signIn() {
    active.current += 1;
    pending.current = false;
    setBusy(false);
    setResult(undefined);
    onSignIn();
  }
  return (
    <>
      <Copy kind="heading">Verify your email</Copy>
      <Copy kind="muted">
        Open the verification link from Auth0, then sign in again to continue. Check your spam folder if you
        don’t see it.
      </Copy>
      <Button title="I verified my email — sign in" loading={loading} onPress={signIn} />
      <Button
        title={cooldown ? 'Wait a minute before resending' : 'Resend verification email'}
        variant="secondary"
        loading={busy}
        disabled={loading || cooldown}
        onPress={() => void resend()}
      />
      {result && <Banner message={result.message} error={result.error} />}
      <Button title="Use a different account" variant="secondary" disabled={loading} onPress={signIn} />
    </>
  );
}
