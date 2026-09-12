import type { Pool } from 'pg';
import { AccountDeletionStatus } from '@rove/contracts';
import type { Actor } from './rides';
import { DomainError } from './errors';
import { transaction } from './transactions';
import { requireStaffPermission } from './staff-access';

/** The durable request survives support resolution. No request alone authorizes erasure. */
export class AccountDeletions {
  constructor(private pool: Pool) {}
  async status(actor: Actor) {
    return transaction(this.pool, async (client) => {
      if (!['rider', 'driver'].includes(actor.role))
        throw new DomainError('FORBIDDEN', 'A consumer account is required.', 403);
      const owner = await client.query(
        'SELECT id FROM users WHERE id=$1 AND role=$2 AND disabled=false FOR SHARE',
        [actor.id, actor.role],
      );
      if (!owner.rowCount) throw new DomainError('FORBIDDEN', 'Account is unavailable.', 403);
      const row = (
        await client.query(
          'SELECT id,support_request_id,consent_version,created_at FROM account_deletion_requests WHERE owner_id=$1',
          [actor.id],
        )
      ).rows[0];
      return AccountDeletionStatus.parse({
        request: row
          ? {
              id: row.id,
              supportRequestId: row.support_request_id,
              consentVersion: row.consent_version,
              state: 'requested',
              createdAt: row.created_at.toISOString(),
            }
          : null,
      });
    });
  }
  async inspect(actor: Actor, requestId: string) {
    return transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, 'privacy.read');
      const row = (
        await client.query(
          'SELECT id,support_request_id,consent_version,created_at FROM account_deletion_requests WHERE id=$1',
          [requestId],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Deletion request not found.', 404);
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'account_deletion.viewed',$2,'{}')",
        [actor.id, requestId],
      );
      return AccountDeletionStatus.parse({
        request: {
          id: row.id,
          supportRequestId: row.support_request_id,
          consentVersion: row.consent_version,
          state: 'requested',
          createdAt: row.created_at.toISOString(),
        },
      });
    });
  }
}
