import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import {
  RetentionHold,
  RetentionHoldInput,
  RetentionHoldRelease,
  RetentionHoldQuery,
  RetentionHoldQueue,
} from '@rove/contracts';
import type { Actor } from './rides';
import { DomainError } from './errors';
import { transaction, command } from './transactions';
import { requireStaffPermission } from './staff-access';

/** Use this same user-row lock for every future destructive cleanup stage. Review dates never expire holds. */
export async function assertNoRetentionHolds(c: PoolClient, ownerId: string) {
  const owner = await c.query("SELECT id FROM users WHERE id=$1 AND role IN ('rider','driver') FOR UPDATE", [
    ownerId,
  ]);
  if (!owner.rowCount) throw new DomainError('NOT_FOUND', 'Consumer account not found.', 404);
  if (
    (
      await c.query('SELECT id FROM retention_holds WHERE owner_id=$1 AND released_at IS NULL LIMIT 1', [
        ownerId,
      ])
    ).rowCount
  )
    throw new DomainError('RETENTION_HOLD', 'An active retention hold blocks this operation.', 409);
}
function dto(row: Record<string, unknown>) {
  return RetentionHold.parse({
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    reasonReference: row.reason_reference,
    reviewAt: (row.review_at as Date).toISOString(),
    createdAt: (row.created_at as Date).toISOString(),
    releasedAt: row.released_at ? (row.released_at as Date).toISOString() : null,
    releaseReference: row.release_reference ?? null,
    identityAttemptedAt: row.identity_attempted_at ? (row.identity_attempted_at as Date).toISOString() : null,
    identityRemovedAt: row.identity_removed_at ? (row.identity_removed_at as Date).toISOString() : null,
  });
}
const select = `SELECT h.*,o.identity_removed_at,o.identity_attempted_at,to_char(h.review_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_review_time FROM retention_holds h LEFT JOIN account_closures o ON o.owner_id=h.owner_id`;
export class RetentionHolds {
  constructor(private pool: Pool) {}
  async place(actor: Actor, ownerId: string, raw: unknown, key: string) {
    z.uuid().parse(ownerId);
    const input = RetentionHoldInput.parse(raw);
    await transaction(this.pool, (c) => requireStaffPermission(c, actor, 'privacy.hold'));
    return command(this.pool, actor.id, key, { action: 'retention.hold', ownerId, ...input }, async (c) => {
      await requireStaffPermission(c, actor, 'privacy.hold');
      const owner = await c.query(
        "SELECT id FROM users WHERE id=$1 AND role IN ('rider','driver') FOR UPDATE",
        [ownerId],
      );
      if (!owner.rowCount) throw new DomainError('NOT_FOUND', 'Consumer account not found.', 404);
      const found = (
        await c.query(
          select.replace('SELECT h.*', 'SELECT h.review_at=$4::timestamptz AS same_review,h.*') +
            ' WHERE h.owner_id=$1 AND h.kind=$2 AND h.reason_reference=$3 AND h.released_at IS NULL',
          [ownerId, input.kind, input.reasonReference, input.reviewAt],
        )
      ).rows[0];
      if (found) {
        if (!found.same_review)
          throw new DomainError(
            'RETENTION_HOLD_EXISTS',
            'This case already has a hold with another review date.',
            409,
          );
        return dto(found);
      }
      const row = (
        await c.query(
          `INSERT INTO retention_holds(owner_id,kind,reason_reference,review_at,placed_by) VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [ownerId, input.kind, input.reasonReference, input.reviewAt, actor.id],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'retention.held',$2,$3)",
        [
          actor.id,
          row.id,
          JSON.stringify({
            kind: input.kind,
            reasonReference: input.reasonReference,
            reviewAt: input.reviewAt,
          }),
        ],
      );
      return dto((await c.query(select + ' WHERE h.id=$1', [row.id])).rows[0]);
    });
  }
  async release(actor: Actor, holdId: string, raw: unknown, key: string) {
    z.uuid().parse(holdId);
    const input = RetentionHoldRelease.parse(raw);
    await transaction(this.pool, (c) => requireStaffPermission(c, actor, 'privacy.release-hold'));
    return command(this.pool, actor.id, key, { action: 'retention.release', holdId, ...input }, async (c) => {
      await requireStaffPermission(c, actor, 'privacy.release-hold');
      const initial = (await c.query('SELECT owner_id FROM retention_holds WHERE id=$1', [holdId])).rows[0];
      if (!initial) throw new DomainError('NOT_FOUND', 'Retention hold not found.', 404);
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [initial.owner_id]);
      const row = (await c.query('SELECT * FROM retention_holds WHERE id=$1 FOR UPDATE', [holdId])).rows[0];
      if (row.released_at) {
        if (row.release_reference !== input.releaseReference)
          throw new DomainError(
            'RETENTION_HOLD_RELEASED',
            'This hold was already released with another review reference.',
            409,
          );
        return dto((await c.query(select + ' WHERE h.id=$1', [holdId])).rows[0]);
      }
      await c.query(
        'UPDATE retention_holds SET released_at=now(),released_by=$2,release_reference=$3 WHERE id=$1',
        [holdId, actor.id, input.releaseReference],
      );
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'retention.released',$2,$3)",
        [actor.id, holdId, JSON.stringify(input)],
      );
      return dto((await c.query(select + ' WHERE h.id=$1', [holdId])).rows[0]);
    });
  }
  async list(actor: Actor, raw: unknown = {}) {
    const parsed = RetentionHoldQuery.safeParse(raw);
    if (!parsed.success) throw new DomainError('INVALID_QUERY', 'Check hold filters and cursor.', 400);
    const q = parsed.data;
    return transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, 'privacy.read');
      const result = await c.query(
        select +
          ` WHERE (h.released_at IS NULL)=($1='active')
        AND ($2::uuid IS NULL OR h.owner_id=$2) AND ($3::timestamptz IS NULL OR (h.review_at,h.id)>($3::timestamptz,$4::uuid))
        ORDER BY h.review_at,h.id LIMIT 51`,
        [q.status, q.ownerId ?? null, q.afterReviewAt ?? null, q.afterId ?? null],
      );
      const rows = result.rows.slice(0, 50),
        last = rows.at(-1);
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'retention.queue_viewed',$1,$2)",
        [actor.id, JSON.stringify({ status: q.status, count: rows.length })],
      );
      return RetentionHoldQueue.parse({
        holds: rows.map(dto),
        nextCursor:
          result.rows.length > 50 && last
            ? { afterReviewAt: last.cursor_review_time, afterId: last.id }
            : null,
      });
    });
  }
}
