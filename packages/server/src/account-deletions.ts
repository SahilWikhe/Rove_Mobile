import { bindUserRead } from './user-scope';
import { appendAudit } from './audit';
import { actorTransaction, bindActorIdentity } from './actor-transaction';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { AccountDeletionInventory, AccountDeletionStatus } from '@rove/contracts';
import type { Actor } from './rides';
import { DomainError } from './errors';
import { transaction, command } from './transactions';
import { requireStaffPermission } from './staff-access';

/** The durable request survives support resolution. No request alone authorizes erasure. */
export class AccountDeletions {
  constructor(private pool: Pool) {}
  async status(actor: Actor) {
    return actorTransaction(this.pool, actor, async (client) => {
      if (!['rider', 'driver'].includes(actor.role))
        throw new DomainError('FORBIDDEN', 'A consumer account is required.', 403);
      await bindUserRead(client, actor.id);
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
      await bindUserRead(client, actor.id);
      const owner = await client.query(
        'SELECT id FROM users WHERE id=$1 AND role=$2 AND disabled=false FOR UPDATE',
        [actor.id, actor.role],
      );
      if (!owner.rowCount) throw new DomainError('FORBIDDEN', 'Account is unavailable.', 403);
      await bindActorIdentity(client, actor, 'update');
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
          await appendAudit(client, actor.id, 'account_deletion.withdrawn', requestId, '{}');
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
  async inventory(actor: Actor, requestId: string) {
    z.uuid().parse(requestId);
    return actorTransaction(this.pool, actor, async (client) => {
      await requireStaffPermission(client, actor, 'privacy.read');
      // One SQL statement observes all counts at the same database snapshot. Counts do not imply eligibility.
      const row = (
        await client.query(
          `
        SELECT r.id, r.withdrawn_at, o.closed_at, o.identity_removed_at,
          statement_timestamp() AS observed_at,
          (SELECT count(*) FROM retention_holds h WHERE h.owner_id=r.owner_id AND h.released_at IS NULL) AS holds,
          (SELECT count(*) FROM trip_messages m WHERE m.sender_id=r.owner_id) AS messages,
          (SELECT count(*) FROM saved_places p WHERE p.rider_id=r.owner_id) AS places,
          (SELECT count(*) FROM push_installations p WHERE p.owner_id=r.owner_id) AS pushes,
          (SELECT count(*) FROM support_requests s WHERE s.owner_id=r.owner_id) AS support,
          (SELECT count(*) FROM driver_documents d WHERE d.driver_id=r.owner_id) AS documents
        FROM account_deletion_requests r
        LEFT JOIN account_closures o ON o.request_id=r.id
        WHERE r.id=$1`,
          [requestId],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Deletion request not found.', 404);
      const result = AccountDeletionInventory.parse({
        requestId: row.id,
        observedAt: row.observed_at.toISOString(),
        withdrawn: !!row.withdrawn_at,
        accessClosed: !!row.closed_at,
        identityRemoved: !!row.identity_removed_at,
        activeHoldCount: Number(row.holds),
        counts: {
          authoredMessages: Number(row.messages),
          savedPlaces: Number(row.places),
          pushInstallations: Number(row.pushes),
          supportRequests: Number(row.support),
          documentReservations: Number(row.documents),
        },
        completeErasureVerified: false,
      });
      await appendAudit(
        client,
        actor.id,
        'account_deletion.inventory_viewed',
        requestId,
        JSON.stringify({
          observedAt: result.observedAt,
          counts: result.counts,
          activeHoldCount: result.activeHoldCount,
        }),
      );
      return result;
    });
  }
  async inspect(actor: Actor, requestId: string) {
    return actorTransaction(this.pool, actor, async (client) => {
      await requireStaffPermission(client, actor, 'privacy.read');
      const row = (
        await client.query(
          'SELECT r.id,r.support_request_id,r.consent_version,r.created_at,r.withdrawn_at,o.closed_at,o.identity_removed_at FROM account_deletion_requests r LEFT JOIN account_closures o ON o.request_id=r.id WHERE r.id=$1',
          [requestId],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Deletion request not found.', 404);
      await appendAudit(client, actor.id, 'account_deletion.viewed', requestId, '{}');
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
