import { createContext, useContext } from 'react';
export interface Payments {
  available: boolean;
  pay(rideId: string, current: () => boolean): Promise<'submitted' | 'cancelled' | 'abandoned'>;
}
export const PaymentsContext = createContext<Payments>({
  available: false,
  pay: async () => {
    throw new Error('Payments are unavailable.');
  },
});
export const usePayments = () => useContext(PaymentsContext);
