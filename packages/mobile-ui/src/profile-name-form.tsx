import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Card, Copy, Field } from './index';

/** Mount with an account-ID key. Draft names stay in memory on this screen. */
export function ProfileNameForm({
  initialName,
  save,
  reload,
  disabled = false,
}: {
  initialName: string;
  disabled?: boolean;
  save: (name: string, expectedName: string) => Promise<string>;
  reload: () => Promise<string>;
}) {
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(refresh: boolean) {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = refresh ? await reload() : await save(name.trim(), savedName);
      if (!mounted.current) return;
      setName(updated);
      setSavedName(updated);
      setSaved(!refresh);
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : 'Your profile could not be updated.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Card>
      <Copy kind="label">PROFILE NAME</Copy>
      <Copy kind="muted">The name shown in your Rove profile and assigned trips.</Copy>
      <Field
        label="Your name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setSaved(false);
        }}
        editable={!busy && !disabled}
        maxLength={100}
        autoComplete="name"
        autoCapitalize="words"
      />
      {error && <Banner error message={error} />}
      {saved && <Banner message="Your name is saved." />}
      <Button
        title="Save name"
        loading={busy}
        disabled={disabled || !name.trim() || name.trim() === savedName}
        onPress={() => void run(false)}
      />
      <Button
        title="Reload saved name"
        variant="secondary"
        disabled={busy || disabled}
        onPress={() => void run(true)}
      />
      <Copy kind="muted">Reload replaces your unsaved edit with the name currently on your account.</Copy>
    </Card>
  );
}
