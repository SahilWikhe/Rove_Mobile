import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { AccountClosureAuthorization, AccountClosure } from '@rove/contracts';
import type { Actor } from './rides';
import type { JobHandler } from './outbox';
import { DomainError } from './errors';
import { transaction, command } from './transactions';
import { requireStaffPermission } from './staff-access';

export interface IdentityDeletionProvider {
  erase(subject: string): Promise<{ status: 'absent' }>;
}
const permission = 'privacy.close';
const unavailable = () =>
  new DomainError(
    'ACCOUNT_CLOSURE_HOLD',
    'Resolve active trips and financial obligations before closing this account.',
    409,
  );
function dto(row: Record<string, unknown>) {
  return AccountClosure.parse({
    requestId: row.request_id,
    state: row.identity_removed_at ? 'identity_removed' : 'closed',
    closedAt: (row.closed_at as Date).toISOString(),
    identityRemovedAt: row.identity_removed_at ? (row.identity_removed_at as Date).toISOString() : null,
  });
}
/** Account/identity closure is deliberately not a declaration that all retained data is erased. */
export class AccountClosures {
  constructor(
    private pool: Pool,
    private provider: IdentityDeletionProvider,
    private policyReference: string,
  ) {
    AccountClosureAuthorization.shape.policyReference.parse(policyReference);
  }
  private async permitted(c: PoolClient, actor: Actor) {
    await requireStaffPermission(c, actor, permission);
  }
  async authorize(actor: Actor, requestId: string, raw: unknown, key: string) {
    z.uuid().parse(requestId);
    const input = AccountClosureAuthorization.parse(raw);
    if (input.policyReference !== this.policyReference)
      throw new DomainError('ACCOUNT_CLOSURE_POLICY', 'Use the configured approved closure policy.', 409);
    await transaction(this.pool, (c) => this.permitted(c, actor));
    return command(this.pool, actor.id, key, { action: 'account.close', requestId, ...input }, async (c) => {
      await this.permitted(c, actor);
      const request = (
        await c.query('SELECT owner_id FROM account_deletion_requests WHERE id=$1 FOR UPDATE', [requestId])
      ).rows[0];
      if (!request) throw new DomainError('NOT_FOUND', 'Deletion request not found.', 404);
      const existing = (await c.query('SELECT * FROM account_closures WHERE request_id=$1', [requestId]))
        .rows[0];
      if (existing) return dto(existing);
      const ownerId = request.owner_id as string;
      // Driver acceptance/availability serialize on the driver row. Do not lock ride
      // rows here (acceptance takes ride then driver). New rider requests lock users.
      await c.query('SELECT id FROM drivers WHERE id=$1 FOR UPDATE', [ownerId]);
      const owner = (
        await c.query(
          "SELECT id,role,disabled FROM users WHERE id=$1 AND role IN ('rider','driver') FOR UPDATE",
          [ownerId],
        )
      ).rows[0];
      if (!owner || owner.disabled)
        throw new DomainError(
          'ACCOUNT_CLOSURE_REVIEW',
          'Review this unavailable account before closure.',
          409,
        );
      const active = await c.query(
        "SELECT id FROM rides WHERE (rider_id=$1 OR driver_id=$1) AND state IN ('searching','matched','en_route','arrived','in_progress','interrupted') LIMIT 1",
        [ownerId],
      );
      if (active.rowCount) throw unavailable();
      // Financial reconciliation locks the same payment rows before changing its
      // status/journals. Freeze these observations for the closure decision.
      await c.query(
        `SELECT p.id FROM payment_attempts p JOIN rides r ON r.id=p.ride_id
        WHERE r.rider_id=$1 OR r.driver_id=$1 ORDER BY p.id FOR UPDATE OF p`,
        [ownerId],
      );
      const balance = await c.query(
        'SELECT account FROM ledger_postings WHERE owner_id=$1 GROUP BY account HAVING sum(amount_cents)<>0 LIMIT 1',
        [ownerId],
      );
      const unsettled = await c.query(
        `SELECT p.id FROM payment_attempts p JOIN rides r ON r.id=p.ride_id WHERE (r.rider_id=$1 OR r.driver_id=$1)
        AND (p.provider_status IS NULL OR p.provider_status NOT IN ('succeeded','canceled')) LIMIT 1`,
        [ownerId],
      );
      const operations = await c.query(
        `SELECT o.id FROM driver_transfer_operations o WHERE o.driver_id=$1 AND o.state IN ('queued','review_required') LIMIT 1`,
        [ownerId],
      );
      const refunds = await c.query(
        `SELECT o.id FROM refund_operations o JOIN payment_attempts p ON p.id=o.attempt_id JOIN rides r ON r.id=p.ride_id
        WHERE (r.rider_id=$1 OR r.driver_id=$1) AND o.state IN ('queued','review_required') LIMIT 1`,
        [ownerId],
      );
      if (balance.rowCount || unsettled.rowCount || operations.rowCount || refunds.rowCount)
        throw unavailable();
      // Preserve the original unique subject on a disabled row: old JWTs cannot
      // create a fresh local account after Auth0 deletion. Anonymization comes later.
      await c.query('UPDATE users SET disabled=true WHERE id=$1', [ownerId]);
      await c.query(
        'UPDATE drivers SET online=false,location=NULL,location_at=NULL,location_sampled_at=NULL,location_sequence=location_sequence+1 WHERE id=$1',
        [ownerId],
      );
      await c.query('DELETE FROM driver_tracking_sessions WHERE driver_id=$1', [ownerId]);
      await c.query(
        `UPDATE push_installations SET enabled=false,token='',revision=revision+1,mutation_id=NULL,mutation_hash=NULL,updated_at=now() WHERE owner_id=$1`,
        [ownerId],
      );
      await c.query('DELETE FROM saved_places WHERE rider_id=$1', [ownerId]);
      const row = (
        await c.query(
          `INSERT INTO account_closures(request_id,owner_id,authorized_by,policy_reference,review_reference)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [requestId, ownerId, actor.id, input.policyReference, input.reviewReference],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'account.closed',$2,$3)",
        [actor.id, requestId, JSON.stringify(input)],
      );
      await c.query(
        "INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key) VALUES('account.identity-delete',$1,'{}',$2) ON CONFLICT(dedupe_key) DO NOTHING",
        [requestId, 'account.identity-delete:' + requestId],
      );
      return dto(row);
    });
  }
  async inspect(actor: Actor, requestId: string) {
    z.uuid().parse(requestId);
    return transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, 'privacy.read');
      const row = (await c.query('SELECT * FROM account_closures WHERE request_id=$1', [requestId])).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Account closure not found.', 404);
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'account.closure_viewed',$2,'{}')",
        [actor.id, requestId],
      );
      return dto(row);
    });
  }
  async retryIdentity(actor: Actor, requestId: string, key: string) {
    z.uuid().parse(requestId);
    await transaction(this.pool, (c) => this.permitted(c, actor));
    return command(this.pool, actor.id, key, { action: 'account.identity-retry', requestId }, async (c) => {
      await this.permitted(c, actor);
      const row = (
        await c.query('SELECT identity_removed_at FROM account_closures WHERE request_id=$1 FOR SHARE', [
          requestId,
        ])
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Account closure not found.', 404);
      if (row.identity_removed_at) return { requeued: false };
      const changed = await c.query(
        `UPDATE outbox SET dead_letter_at=NULL,attempts=0,available_at=now(),last_error_code=NULL
        WHERE dedupe_key=$1 AND completed_at IS NULL AND dead_letter_at IS NOT NULL
        AND (locked_until IS NULL OR locked_until<=now()) RETURNING id`,
        ['account.identity-delete:' + requestId],
      );
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'account.identity_retry',$2,$3)",
        [actor.id, requestId, JSON.stringify({ requeued: !!changed.rowCount })],
      );
      return { requeued: !!changed.rowCount };
    });
  }
  readonly handle: JobHandler = async (job) => {
    await this.removeIdentity(job.aggregateId);
  };
  async removeIdentity(requestId: string) {
    z.uuid().parse(requestId);
    const reference = await transaction(this.pool, async (c) => {
      const row = (
        await c.query(
          `SELECT o.identity_removed_at,u.subject,u.disabled FROM account_closures o JOIN users u ON u.id=o.owner_id
        WHERE o.request_id=$1 FOR SHARE OF o,u`,
          [requestId],
        )
      ).rows[0];
      if (!row?.disabled)
        throw new DomainError(
          'ACCOUNT_CLOSURE_REQUIRED',
          'Close local access before deleting identity.',
          409,
        );
      return row.identity_removed_at ? null : (row.subject as string);
    });
    if (!reference) return;
    const result = await this.provider.erase(reference);
    if (result?.status !== 'absent')
      throw new DomainError('IDENTITY_DELETION_UNAVAILABLE', 'Identity removal is not verified.', 503);
    await transaction(this.pool, async (c) => {
      const row = (
        await c.query(
          `SELECT o.identity_removed_at,u.subject,u.disabled FROM account_closures o JOIN users u ON u.id=o.owner_id
        WHERE o.request_id=$1 FOR UPDATE OF o FOR SHARE OF u`,
          [requestId],
        )
      ).rows[0];
      if (!row?.disabled || row.subject !== reference)
        throw new DomainError('ACCOUNT_CLOSURE_CHANGED', 'Review changed account closure.', 409);
      if (row.identity_removed_at) return;
      await c.query('UPDATE account_closures SET identity_removed_at=now() WHERE request_id=$1', [requestId]);
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES(NULL,'account.identity_removed',$1,'{}')",
        [requestId],
      );
    });
  }
}
