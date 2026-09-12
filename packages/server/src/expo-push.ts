import { z } from 'zod';
import { DomainError } from './errors';
import {
  PushMessage,
  type PushFailure,
  type PushProvider,
  type PushReceipt,
  type PushTicket,
} from './push-provider';

type Transport = (url: string, options: RequestInit) => Promise<Response>;
const ReceiptId = z.uuid();
const Failure = z.object({ status: z.literal('error'), details: z.object({ error: z.string() }).optional() });
const Ticket = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), id: ReceiptId }),
  Failure,
]);
const Receipt = z.discriminatedUnion('status', [z.object({ status: z.literal('ok') }), Failure]);
const SendResponse = z.object({ data: Ticket, errors: z.array(z.unknown()).optional() });
const ReceiptResponse = z.object({
  data: z.record(ReceiptId, Receipt),
  errors: z.array(z.unknown()).optional(),
});

function failure(code: string | undefined): PushFailure {
  if (code === 'DeviceNotRegistered') return 'invalid_token';
  if (code === 'MessageRateExceeded') return 'retryable';
  if (code === 'InvalidCredentials' || code === 'MismatchSenderId') return 'configuration';
  return 'rejected';
}

/** One recipient per request avoids cross-project batches. Durable orchestration owns retry policy. */
export class ExpoPushProvider implements PushProvider {
  constructor(
    private accessToken: string,
    private transport: Transport = (url, options) => fetch(url, options),
    private now: () => Date = () => new Date(),
  ) {
    if (!/^[\x21-\x7e]{1,4096}$/.test(accessToken))
      throw new Error('An Expo server access token is required.');
  }
  private async call(path: 'send' | 'getReceipts', body: unknown): Promise<unknown> {
    try {
      const response = await this.transport(`https://exp.host/--/api/v2/push/${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429 || response.status >= 500)
          throw new DomainError(
            'PUSH_PROVIDER_UNAVAILABLE',
            'Push provider is temporarily unavailable.',
            503,
          );
        throw new DomainError(
          'PUSH_PROVIDER_REJECTED',
          'Push provider configuration or request needs review.',
          422,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65_536) {
            await reader.cancel();
            throw new Error('Response limit');
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      // A send can have been accepted before its response was lost. Never echo tokens/provider bodies.
      throw new DomainError(
        path === 'send' ? 'PUSH_SEND_UNCONFIRMED' : 'PUSH_RECEIPT_UNAVAILABLE',
        'Push provider result could not be confirmed.',
        503,
      );
    }
  }
  async send(input: PushMessage): Promise<PushTicket> {
    const parsed = PushMessage.safeParse(input);
    if (!parsed.success) throw new DomainError('INVALID_PUSH_MESSAGE', 'Invalid push message.', 400);
    const message = parsed.data;
    const ttl = Math.floor((Date.parse(message.expiresAt) - this.now().getTime()) / 1000);
    if (ttl <= 0) return { status: 'expired' };
    if (ttl > 300)
      throw new DomainError('INVALID_PUSH_EXPIRY', 'Push hints must expire within five minutes.', 400);
    const result = SendResponse.safeParse(
      await this.call('send', {
        to: message.token,
        title: 'Rove',
        body:
          message.hint.kind === 'message_available'
            ? 'You have a new trip message. Open Rove to read it.'
            : 'Open Rove to check your latest trip information.',
        data: message.hint,
        ttl,
        priority: 'high',
        sound: 'default',
        channelId: 'default',
        collapseId: message.hint.referenceId,
        tag: message.hint.referenceId,
      }),
    );
    if (!result.success || result.data.errors?.length)
      throw new DomainError('PUSH_SEND_UNCONFIRMED', 'Push provider result could not be confirmed.', 503);
    const ticket = result.data.data;
    return ticket.status === 'ok'
      ? { status: 'accepted', receiptId: ticket.id }
      : { status: failure(ticket.details?.error) };
  }
  async receipt(id: string): Promise<PushReceipt> {
    if (!ReceiptId.safeParse(id).success)
      throw new DomainError('INVALID_PUSH_RECEIPT', 'Invalid push receipt.', 400);
    const result = ReceiptResponse.safeParse(await this.call('getReceipts', { ids: [id] }));
    if (!result.success || result.data.errors?.length)
      throw new DomainError('PUSH_RECEIPT_UNAVAILABLE', 'Push receipt could not be confirmed.', 503);
    const receipt = result.data.data[id];
    if (!receipt) return { status: 'pending' };
    return { status: receipt.status === 'ok' ? 'accepted_by_gateway' : failure(receipt.details?.error) };
  }
}
