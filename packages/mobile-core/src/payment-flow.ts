import type { RideDetails } from '@rove/contracts';

/** Payment entry is scoped to the displayed ride and a successful current read. */
export function paymentAvailability(
  ride: Pick<RideDetails, 'id' | 'state' | 'paymentState'> | null,
  rideId: string,
  readFailed: boolean,
): 'unknown' | 'ready' | 'confirmed' | 'closed' {
  if (!ride || ride.id !== rideId || readFailed) return 'unknown';
  if (ride.paymentState === 'authorized' || ride.paymentState === 'paid') return 'confirmed';
  return ride.state === 'searching' && ['pending', 'action_required'].includes(ride.paymentState)
    ? 'ready'
    : 'closed';
}

/** Concurrent payment refreshes must not undo a newer server-confirmed ride state. */
export function latestPaymentRide<T extends { id: string; version: number }>(
  previous: T | null,
  incoming: T,
): T {
  return previous?.id === incoming.id && previous.version > incoming.version ? previous : incoming;
}

/** Match only the registered payment return route; Stripe validates its own callback state. */
export function isPaymentReturnURL(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'rove-rider:' &&
      (url.hostname === 'payment' || url.hostname === 'payment-methods') &&
      (url.pathname === '' || url.pathname === '/') &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

export interface NativePaymentSheet {
  initialize(
    secret: string,
    customer?: { customerId: string; clientSecret: string },
  ): Promise<{ error?: { code: string } }>;
  present(): Promise<{ error?: { code: string } }>;
}
/** Does not store a secret or assert that a successful sheet response means funds are authorized. */
export async function submitPayment(
  session: () => Promise<{ clientSecret: string; customer?: { customerId: string; clientSecret: string } }>,
  sheet: NativePaymentSheet,
  current: () => boolean,
): Promise<'submitted' | 'cancelled' | 'abandoned'> {
  if (!current()) return 'abandoned';
  try {
    const { clientSecret, customer } = await session();
    if (!current()) return 'abandoned';
    const initialized = customer
      ? await sheet.initialize(clientSecret, customer)
      : await sheet.initialize(clientSecret);
    if (!current()) return 'abandoned';
    if (initialized.error) throw new Error('Initialization failed');
    const presented = await sheet.present();
    if (!current()) return 'abandoned';
    if (presented.error?.code === 'Canceled') return 'cancelled';
    if (presented.error) throw new Error('Confirmation failed');
    return 'submitted';
  } catch {
    // Native SDK errors may include payment details. Never surface raw exceptions.
    if (!current()) return 'abandoned';
    throw new Error('Payment could not be confirmed. Check your ride status before trying again.');
  }
}

/** Native SDK callbacks may outlive the sheet that registered them. */
export function paymentCallbackScope(current: () => boolean) {
  let open = true;
  const valid = () => open && current();
  return {
    close: () => {
      open = false;
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (!valid()) throw new Error('Payment settings closed.');
      const result = await operation();
      if (!valid()) throw new Error('Payment settings closed.');
      return result;
    },
  };
}
