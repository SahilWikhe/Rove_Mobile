import { useEffect, useRef, useState } from 'react';
import type { Place, SavedPlaceKind } from '@rove/contracts';
import type { ApiClient } from '@rove/mobile-core';
import { Banner, Button, Card, Copy } from '@rove/mobile-ui';
type Slots = { kind: SavedPlaceKind; placeId: string }[];
export function SavedPlaceControls({
  api,
  selected,
  target,
  busy,
  onUse,
}: {
  api: ApiClient;
  selected: Place | null;
  target: 'pickup' | 'destination';
  busy: boolean;
  onUse: (kind: SavedPlaceKind) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [slots, setSlots] = useState<Slots | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function refresh() {
    const data = await api.savedPlaces();
    if (mounted.current) setSlots(data.places);
  }
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (failure) {
      if (mounted.current) {
        setSlots(null);
        setError(failure instanceof Error ? failure.message : 'Unable to update saved places.');
      }
    } finally {
      running.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  const disabled = loading || busy;
  return (
    <Card style={{ padding: 18, borderRadius: 18, gap: 12 }}>
      <Button
        title={expanded ? 'Hide saved places' : 'Home & Work'}
        variant="secondary"
        disabled={disabled}
        onPress={() => {
          setExpanded(!expanded);
          if (!expanded) void run(refresh);
        }}
      />
      {expanded && (
        <>
          <Copy kind="heading">Your saved places.</Copy>
          {error && <Banner error message={error} />}
          {message && <Copy>{message}</Copy>}
          {!slots && (
            <Button
              title="Load saved places"
              loading={loading}
              disabled={busy}
              onPress={() => void run(refresh)}
            />
          )}
          {slots &&
            (['home', 'work'] as const).map((kind) => {
              const slot = slots.find((value) => value.kind === kind);
              const label = kind === 'home' ? 'Home' : 'Work';
              return (
                <Card key={kind} style={{ padding: 14, gap: 10 }}>
                  <Copy kind="heading">{label}</Copy>
                  <Copy kind="muted">{slot ? 'Saved to your account.' : 'No place saved yet.'}</Copy>
                  {slot && (
                    <Button
                      title={`Use ${label} as ${target}`}
                      disabled={disabled}
                      onPress={() => onUse(kind)}
                    />
                  )}
                  {selected && (
                    <>
                      <Copy kind="muted">
                        {slot ? 'Replace with:' : 'Save:'} {selected.label}
                      </Copy>
                      <Button
                        title={`${slot ? 'Replace' : 'Save'} ${label}`}
                        variant="secondary"
                        disabled={disabled || slot?.placeId === selected.id}
                        onPress={() =>
                          void run(async () => {
                            await api.savePlace(kind, selected.id, slot?.placeId ?? null);
                            await refresh();
                            if (mounted.current) setMessage(`${label} saved.`);
                          })
                        }
                      />
                    </>
                  )}
                  {slot && (
                    <Button
                      title={`Remove ${label}`}
                      variant="secondary"
                      disabled={disabled}
                      onPress={() =>
                        void run(async () => {
                          await api.removeSavedPlace(kind, slot.placeId);
                          await refresh();
                          if (mounted.current) setMessage(`${label} removed.`);
                        })
                      }
                    />
                  )}
                </Card>
              );
            })}
          {!selected && <Copy kind="muted">Choose an address from search to save it here.</Copy>}
        </>
      )}
    </Card>
  );
}
