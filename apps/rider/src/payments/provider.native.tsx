import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, type PropsWithChildren } from 'react';
import { Linking } from 'react-native';
import { StripeProvider, useStripe, CustomerSheet } from '@stripe/stripe-react-native';
import { useSession } from '@rove/mobile-core/session';
import { isPaymentReturnURL, submitPayment, paymentCallbackScope } from '@rove/mobile-core/payment-flow';
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
      if (mounted.current && isPaymentReturnURL(url)) void handleURLCallback(url).catch(() => {});
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
            initialize: (secret, customer) =>
              initPaymentSheet({
                merchantDisplayName: 'Rove',
                paymentIntentClientSecret: secret,
                ...(customer
                  ? { customerId: customer.customerId, customerSessionClientSecret: customer.clientSecret }
                  : {}),
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
  const manage = useCallback(
    async (current: () => boolean): Promise<'closed' | 'abandoned'> => {
      const valid = () => mounted.current && current();
      if (!valid()) return 'abandoned';
      if (busy.current) throw new Error('Payment settings are already open.');
      busy.current = true;
      const callbacks = paymentCallbackScope(valid);
      try {
        const initialized = await CustomerSheet.initialize({
          merchantDisplayName: 'Rove',
          headerTextForSelectionScreen: 'Saved payment methods',
          style: 'alwaysDark',
          returnURL: 'rove-rider://payment-methods',
          intentConfiguration: {},
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
          clientSecretProvider: {
            provideCustomerSessionClientSecret: () => callbacks.run(() => api.walletCustomerSession()),
            provideSetupIntentClientSecret: async () =>
              (await callbacks.run(() => api.walletSetupSession(Crypto.randomUUID()))).clientSecret,
          },
        });
        if (!valid()) return 'abandoned';
        if (initialized.error) throw new Error('Settings initialization failed.');
        const result = await CustomerSheet.present();
        if (!valid()) return 'abandoned';
        if (result.error && result.error.code !== 'Canceled') throw new Error('Settings could not open.');
        return 'closed';
      } catch {
        if (!valid()) return 'abandoned';
        throw new Error('Payment settings could not be loaded. Please try again.');
      } finally {
        callbacks.close();
        busy.current = false;
      }
    },
    [api],
  );
  const value = useMemo(() => ({ available: true, pay, manage }), [pay, manage]);
  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}
