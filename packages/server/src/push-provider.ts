import { PushHint } from '@rove/contracts';
export { PushHint } from '@rove/contracts';
import { z } from 'zod';

export const PushToken = z
  .string()
  .max(256)
  .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/);
export const PushMessage = z
  .object({
    token: PushToken,
    hint: PushHint,
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type PushMessage = z.infer<typeof PushMessage>;
export type PushFailure = 'invalid_token' | 'retryable' | 'configuration' | 'rejected';
export type PushTicket =
  { status: 'accepted'; receiptId: string } | { status: 'expired' } | { status: PushFailure };
export type PushReceipt = { status: 'pending' | 'accepted_by_gateway' | PushFailure };
export interface PushProvider {
  send(message: PushMessage): Promise<PushTicket>;
  receipt(id: string): Promise<PushReceipt>;
}
