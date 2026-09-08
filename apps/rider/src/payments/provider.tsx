import type { PropsWithChildren } from 'react';
/** Web preview keeps native Stripe code out of its bundle. Use the iOS/Android app for payments. */
export function PaymentProvider({ children }: PropsWithChildren) {
  return children;
}
