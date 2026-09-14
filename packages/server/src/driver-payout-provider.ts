import type { DriverPayoutLink } from '@rove/contracts';
export interface DriverPayoutReference {
  driverId: string;
  bindingId: string;
}
export interface DriverPayoutProvider {
  createAccount(reference: DriverPayoutReference & { contactEmail: string }, key: string): Promise<string>;
  status(
    reference: DriverPayoutReference & { accountId: string },
  ): Promise<'pending' | 'needs_information' | 'ready'>;
  onboardingLink(accountId: string): Promise<DriverPayoutLink>;
}
