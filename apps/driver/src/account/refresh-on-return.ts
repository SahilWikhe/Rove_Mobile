import { AppState } from 'react-native';

/** Subscribe only while the payout screen is focused; returning is a read, never a payout mutation. */
export function refreshOnReturn(refresh: () => void) {
  let previous = AppState.currentState;
  let disposed = false;
  const subscription = AppState.addEventListener('change', (next) => {
    const returned = previous !== 'active' && next === 'active';
    previous = next;
    if (!disposed && returned) refresh();
  });
  return () => {
    disposed = true;
    subscription.remove();
  };
}
