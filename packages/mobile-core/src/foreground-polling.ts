import { AppState } from 'react-native';
import { createPoller, type PollOptions } from './polling';
/** Call from useFocusEffect; return cleanup so hidden/unmounted screens stop immediately. */
export function pollWhileForeground<T>(options: PollOptions<T>) {
  const poller = createPoller(options);
  const subscription = AppState.addEventListener('change', (state) => poller.setActive(state === 'active'));
  poller.setActive(AppState.currentState === 'active');
  return () => {
    subscription.remove();
    poller.dispose();
  };
}
