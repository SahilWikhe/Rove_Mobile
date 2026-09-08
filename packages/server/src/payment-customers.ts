import type { Pool } from 'pg';
import type { Actor } from './rides';
import type { PaymentCustomerProvider } from './payment-provider';
import { DomainError } from './errors';
import { transaction } from './transactions';

/** Minimal provider customer provisioning; raw names, emails and card details are not sent. */
export class PaymentCustomers {
  constructor(
    private pool: Pool,
    private provider: PaymentCustomerProvider,
    private source: string,
    private now: () => Date = () => new Date(),
  ) {
    if (!/^acct_[a-zA-Z0-9]{1,96}:(test|live)$/.test(source)) throw new Error('Invalid payment source.');
  }
  async ensure(actor: Actor): Promise<void> {
    if (actor.role !== 'rider')
      throw new DomainError('FORBIDDEN', 'Payment profiles are for rider accounts.', 403);
    const binding = await transaction(this.pool, async (client) => {
      const user = (
        await client.query<{ role: string; disabled: boolean }>(
          'SELECT role,disabled FROM users WHERE id=$1 FOR UPDATE',
          [actor.id],
        )
      ).rows[0];
      if (!user || user.role !== 'rider' || user.disabled)
        throw new DomainError('FORBIDDEN', 'Payment profile is unavailable.', 403);
      const row = (
        await client.query<{ id: string; customer_id: string | null; created_at: Date }>(
          `INSERT INTO payment_customers(rider_id,source,created_at) VALUES ($1,$2,$3)
         ON CONFLICT(rider_id,source) DO UPDATE SET rider_id=EXCLUDED.rider_id RETURNING *`,
          [actor.id, this.source, this.now()],
        )
      ).rows[0]!;
      if (!row.customer_id && this.now().getTime() - row.created_at.getTime() >= 23 * 60 * 60 * 1000)
        throw new DomainError(
          'PAYMENT_CUSTOMER_REVIEW',
          'An earlier payment profile setup needs support review.',
          409,
        );
      return row;
    });
    if (binding.customer_id) return;
    const customerId = await this.provider.createCustomer(
      { riderId: actor.id, bindingId: binding.id },
      `rove:${binding.id}:customer`,
    );
    if (!/^cus_[a-zA-Z0-9]{1,96}$/.test(customerId))
      throw new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment profile could not be verified.', 503);
    const enabled = await transaction(this.pool, async (client) => {
      const user = (
        await client.query<{ role: string; disabled: boolean }>(
          'SELECT role,disabled FROM users WHERE id=$1 FOR UPDATE',
          [actor.id],
        )
      ).rows[0];
      const mapped = await client.query(
        'UPDATE payment_customers SET customer_id=$2 WHERE id=$1 AND (customer_id IS NULL OR customer_id=$2)',
        [binding.id, customerId],
      );
      if (mapped.rowCount !== 1)
        throw new DomainError('PAYMENT_REFERENCE_MISMATCH', 'Payment profile could not be verified.', 503);
      return user?.role === 'rider' && !user.disabled;
    });
    // Retain the recovery mapping even if account disablement raced the provider response.
    if (!enabled) throw new DomainError('FORBIDDEN', 'Payment profile is unavailable.', 403);
  }
}
