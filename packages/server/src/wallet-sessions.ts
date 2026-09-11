import type { Pool } from 'pg';
import { z } from 'zod';
import type { Actor } from './rides';
import type { PaymentCustomers } from './payment-customers';
import { DomainError } from './errors';

export interface WalletProvider {
  customerSession(
    customerId: string,
    purpose?: 'settings' | 'payment',
  ): Promise<{ customerId: string; clientSecret: string }>;
  setupSession(customerId: string, idempotencyKey: string): Promise<{ clientSecret: string }>;
}

/** Grants short-lived native settings access; card details and client secrets are never persisted. */
export class WalletSessions {
  constructor(
    private pool: Pool,
    private provider: WalletProvider,
    private customers: Pick<PaymentCustomers, 'ensure'>,
    private source: string,
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid payment source.');
  }

  private async binding(actor: Actor) {
    if (actor.role !== 'rider') throw new DomainError('FORBIDDEN', 'Payment settings are unavailable.', 403);
    const user = (
      await this.pool.query<{ disabled: boolean; role: string }>(
        'SELECT disabled,role FROM users WHERE id=$1',
        [actor.id],
      )
    ).rows[0];
    if (!user || user.disabled || user.role !== 'rider')
      throw new DomainError('FORBIDDEN', 'Payment settings are unavailable.', 403);
    const row = (
      await this.pool.query<{ id: string; customer_id: string | null }>(
        'SELECT id,customer_id FROM payment_customers WHERE rider_id=$1 AND source=$2',
        [actor.id, this.source],
      )
    ).rows[0];
    return row;
  }

  private async prepare(actor: Actor) {
    await this.binding(actor);
    await this.customers.ensure(actor);
    const row = await this.binding(actor);
    if (!row?.customer_id || !/^cus_[a-zA-Z0-9]{1,96}$/.test(row.customer_id))
      throw new DomainError('PAYMENT_SETTINGS_UNAVAILABLE', 'Payment settings could not be loaded.', 503);
    return { id: row.id, customerId: row.customer_id };
  }

  private async verify(actor: Actor, expected: { id: string; customerId: string }) {
    const row = await this.binding(actor);
    if (row?.id !== expected.id || row.customer_id !== expected.customerId)
      throw new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment settings could not be verified.', 503);
  }

  async customerSession(actor: Actor) {
    const binding = await this.prepare(actor);
    const result = await this.provider.customerSession(binding.customerId);
    await this.verify(actor, binding);
    if (result.customerId !== binding.customerId || !result.clientSecret)
      throw new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment settings could not be verified.', 503);
    return result;
  }

  async setupSession(actor: Actor, requestId: string) {
    if (!z.uuid().safeParse(requestId).success)
      throw new DomainError('INVALID_REQUEST', 'A valid setup request identifier is required.', 422);
    const binding = await this.prepare(actor);
    const result = await this.provider.setupSession(
      binding.customerId,
      `rove:${binding.id}:wallet:${requestId}`,
    );
    await this.verify(actor, binding);
    if (!result.clientSecret)
      throw new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment settings could not be verified.', 503);
    return result;
  }
}
