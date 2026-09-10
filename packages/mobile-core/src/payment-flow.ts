/** Match only the registered payment return route; Stripe validates its own callback state. */
export function isPaymentReturnURL(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'rove-rider:' &&
      url.hostname === 'payment' &&
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
  initialize(secret: string): Promise<{ error?: { code: string } }>;
  present(): Promise<{ error?: { code: string } }>;
}
/** Does not store a secret or assert that a successful sheet response means funds are authorized. */
export async function submitPayment(
  session: () => Promise<{ clientSecret: string }>,
  sheet: NativePaymentSheet,
  current: () => boolean,
): Promise<'submitted' | 'cancelled' | 'abandoned'> {
  if (!current()) return 'abandoned';
  const { clientSecret } = await session();
  if (!current()) return 'abandoned';
  try {
    const initialized = await sheet.initialize(clientSecret);
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
