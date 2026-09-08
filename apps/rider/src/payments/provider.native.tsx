import { useCallback, useEffect, useMemo, useRef, type PropsWithChildren } from 'react';
import { Linking } from 'react-native';
import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
import { useSession } from '@rove/mobile-core/session';
import { submitPayment } from '@rove/mobile-core/payment-flow';
import { theme } from '@rove/mobile-ui';
import { PaymentsContext } from './context';

export function PaymentProvider({ children }: PropsWithChildren) {
  const { synthetic, profile } = useSession();
  const key = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  if (synthetic || !profile || !/^pk_(test|live)_[a-zA-Z0-9]+$/.test(key)) return children;
  return (
    <StripeProvider publishableKey={key} urlScheme="rove-rider">
      <NativePayments key={profile.id}>{children}</NativePayments>
    </StripeProvider>
  );
}
function NativePayments({ children }: PropsWithChildren) {
  const { api } = useSession();
  const { initPaymentSheet, presentPaymentSheet, handleURLCallback } = useStripe();
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const handle = (url: string | null) => {
      if (url?.startsWith('rove-rider://payment')) void handleURLCallback(url).catch(() => {});
    };
    void Linking.getInitialURL()
      .then(handle)
      .catch(() => {});
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [handleURLCallback]);
  const pay = useCallback(
    async (rideId: string, current: () => boolean) => {
      if (busy.current) throw new Error('A payment is already being confirmed.');
      busy.current = true;
      try {
        return await submitPayment(
          () => api.paymentSession(rideId),
          {
            initialize: (secret) =>
              initPaymentSheet({
                merchantDisplayName: 'Rove',
                paymentIntentClientSecret: secret,
                returnURL: `rove-rider://payment?id=${encodeURIComponent(rideId)}`,
                allowsDelayedPaymentMethods: false,
                style: 'alwaysDark',
                primaryButtonLabel: 'Confirm payment',
                appearance: {
                  colors: {
                    primary: theme.gold,
                    background: theme.background,
                    componentBackground: theme.surface,
                    primaryText: theme.text,
                    secondaryText: theme.muted,
                  },
                  shapes: { borderRadius: 16 },
                },
              }),
            present: () => presentPaymentSheet(),
          },
          () => mounted.current && current(),
        );
      } finally {
        busy.current = false;
      }
    },
    [api, initPaymentSheet, presentPaymentSheet],
  );
  const value = useMemo(() => ({ available: true, pay }), [pay]);
  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}
