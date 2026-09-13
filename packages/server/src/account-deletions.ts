import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { AccountDeletionStatus } from '@rove/contracts';
import type { Actor } from './rides';
import { DomainError } from './errors';
import { transaction, command } from './transactions';
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
          'SELECT r.id,r.support_request_id,r.consent_version,r.created_at,r.withdrawn_at,o.closed_at,o.identity_removed_at FROM account_deletion_requests r LEFT JOIN account_closures o ON o.request_id=r.id WHERE r.owner_id=$1 ORDER BY (r.withdrawn_at IS NULL) DESC,r.created_at DESC,r.id DESC LIMIT 1',
          [actor.id],
        )
      ).rows[0];
      return AccountDeletionStatus.parse({
        request: row
          ? {
              id: row.id,
              supportRequestId: row.support_request_id,
              consentVersion: row.consent_version,
              state: row.withdrawn_at
                ? 'withdrawn'
                : row.identity_removed_at
                  ? 'identity_removed'
                  : row.closed_at
                    ? 'closed'
                    : 'requested',
              createdAt: row.created_at.toISOString(),
            }
          : null,
      });
    });
  }
  async withdraw(actor: Actor, requestId: string, key: string) {
    z.uuid().parse(requestId);
    const activeOwner = async (client: PoolClient) => {
      if (!['rider', 'driver'].includes(actor.role))
        throw new DomainError('FORBIDDEN', 'A consumer account is required.', 403);
      const owner = await client.query(
        'SELECT id FROM users WHERE id=$1 AND role=$2 AND disabled=false FOR UPDATE',
        [actor.id, actor.role],
      );
      if (!owner.rowCount) throw new DomainError('FORBIDDEN', 'Account is unavailable.', 403);
    };
    // Reject disabled-account replays as well as new commands.
    await transaction(this.pool, activeOwner);
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'account_deletion.withdraw', requestId },
      async (client) => {
        await activeOwner(client);
        const row = (
          await client.query(
            'SELECT * FROM account_deletion_requests WHERE id=$1 AND owner_id=$2 FOR UPDATE',
            [requestId, actor.id],
          )
        ).rows[0];
        if (!row) throw new DomainError('NOT_FOUND', 'Deletion request not found.', 404);
        if (
          (await client.query('SELECT request_id FROM account_closures WHERE owner_id=$1', [actor.id]))
            .rowCount
        )
          throw new DomainError('ACCOUNT_CLOSURE_REVIEW', 'Account closure has already begun.', 409);
        if (!row.withdrawn_at) {
          await client.query(
            'UPDATE account_deletion_requests SET withdrawn_at=clock_timestamp() WHERE id=$1',
            [requestId],
          );
          await client.query(
            "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'account_deletion.withdrawn',$2,'{}')",
            [actor.id, requestId],
          );
        }
        return AccountDeletionStatus.parse({
          request: {
            id: row.id,
            supportRequestId: row.support_request_id,
            consentVersion: row.consent_version,
            state: 'withdrawn',
            createdAt: row.created_at.toISOString(),
          },
        });
      },
    );
  }
  async inspect(actor: Actor, requestId: string) {
    return transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, 'privacy.read');
      const row = (
        await client.query(
          'SELECT r.id,r.support_request_id,r.consent_version,r.created_at,r.withdrawn_at,o.closed_at,o.identity_removed_at FROM account_deletion_requests r LEFT JOIN account_closures o ON o.request_id=r.id WHERE r.id=$1',
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
          state: row.withdrawn_at
            ? 'withdrawn'
            : row.identity_removed_at
              ? 'identity_removed'
              : row.closed_at
                ? 'closed'
                : 'requested',
          createdAt: row.created_at.toISOString(),
        },
      });
    });
  }
}
