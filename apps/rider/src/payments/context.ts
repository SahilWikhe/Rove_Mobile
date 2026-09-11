import { createContext, useContext } from 'react';
export interface Payments {
  available: boolean;
  manage(current: () => boolean): Promise<'closed' | 'abandoned'>;
  pay(rideId: string, current: () => boolean): Promise<'submitted' | 'cancelled' | 'abandoned'>;
}
export const PaymentsContext = createContext<Payments>({
  available: false,
  manage: async () => {
    throw new Error('Payment settings are unavailable.');
  },
  pay: async () => {
    throw new Error('Payments are unavailable.');
  },
});
export const usePayments = () => useContext(PaymentsContext);
