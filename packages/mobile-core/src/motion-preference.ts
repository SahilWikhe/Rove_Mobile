export interface MotionPreferenceSource {
  read(): Promise<boolean>;
  subscribe(listener: (enabled: boolean) => void): () => void;
}
/** A late initial read must never override a newer accessibility change. */
export function observeMotionPreference(source: MotionPreferenceSource, update: (enabled: boolean) => void) {
  let alive = true;
  let changed = false;
  const unsubscribe = source.subscribe((enabled) => {
    changed = true;
    if (alive) update(enabled);
  });
  void source
    .read()
    .then((enabled) => {
      if (alive && !changed) update(enabled);
    })
    .catch(() => undefined);
  return () => {
    alive = false;
    unsubscribe();
  };
}
