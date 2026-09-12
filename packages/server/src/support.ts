import type { Pool, PoolClient } from 'pg';
import {
  SupportRequest,
  SupportRequestInput,
  SupportResolution,
  SupportQueueQuery,
  SupportQueue,
} from '@rove/contracts';
import type { Actor } from './rides';
import { DomainError } from './errors';
import { command, transaction } from './transactions';
import { requireStaffPermission } from './staff-access';

async function owner(client: PoolClient, actor: Actor) {
  if (!['rider', 'driver'].includes(actor.role))
    throw new DomainError('FORBIDDEN', 'A consumer account is required.', 403);
  const result = await client.query(
    'SELECT id FROM users WHERE id=$1 AND role=$2 AND disabled=false FOR UPDATE',
    [actor.id, actor.role],
  );
  if (!result.rowCount) throw new DomainError('FORBIDDEN', 'This account cannot submit requests.', 403);
}
function dto(row: Record<string, unknown>) {
  return SupportRequest.parse({
    id: row.id,
    category: row.category,
    message: row.message,
    status: row.status,
    response: row.response ?? null,
    resolvedAt: row.resolved_at ? (row.resolved_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  });
}
export class SupportService {
  constructor(private pool: Pool) {}
  async list(actor: Actor) {
    return transaction(this.pool, async (client) => {
      await owner(client, actor);
      const result = await client.query(
        'SELECT id,category,message,status,created_at,response,resolved_at FROM support_requests WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',
        [actor.id],
      );
      return { requests: result.rows.map(dto) };
    });
  }
  async create(actor: Actor, raw: unknown, key: string) {
    const input = SupportRequestInput.parse(raw);
    if (input.deletionConsent && input.category !== 'account')
      throw new DomainError(
        'INVALID_DELETION_REQUEST',
        'Account deletion requires the account category.',
        400,
      );
    // Disabled accounts cannot use command replay to retrieve stored private messages.
    await transaction(this.pool, (client) => owner(client, actor));
    return command(this.pool, actor.id, key, { action: 'support.create', ...input }, async (client) => {
      await owner(client, actor);
      const existing = await client.query(
        "SELECT id,category,message,status,created_at,response,resolved_at FROM support_requests WHERE owner_id=$1 AND category=$2 AND message=$3 AND status='open' LIMIT 1",
        [actor.id, input.category, input.message],
      );
      if (existing.rows[0]) {
        if (input.deletionConsent) await recordDeletionConsent(client, actor, existing.rows[0].id);
        return dto(existing.rows[0]);
      }
      const count = await client.query(
        "SELECT count(*)::int AS count FROM support_requests WHERE owner_id=$1 AND status='open'",
        [actor.id],
      );
      if (count.rows[0].count >= 5)
        throw new DomainError(
          'SUPPORT_LIMIT',
          'You already have five open requests. Review your existing requests.',
          409,
        );
      const result = await client.query(
        'INSERT INTO support_requests(owner_id,category,message) VALUES($1,$2,$3) RETURNING id,category,message,status,created_at,response,resolved_at',
        [actor.id, input.category, input.message],
      );
      const request = dto(result.rows[0]);
      if (input.deletionConsent) await recordDeletionConsent(client, actor, request.id);
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'support.created',$2,$3)",
        [actor.id, request.id, JSON.stringify({ category: input.category })],
      );
      return request;
    });
  }

  async queue(actor: Actor, raw: unknown = {}) {
    const parsed = SupportQueueQuery.safeParse(raw);
    if (!parsed.success) throw new DomainError('INVALID_QUERY', 'Check the queue filters and cursor.', 400);
    const input = parsed.data;
    return transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, 'support.read');
      const result = await client.query(
        `SELECT id,category,status,created_at,
          to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
          FROM support_requests WHERE status=$1
          AND ($2::timestamptz IS NULL OR (created_at,id)>($2::timestamptz,$3::uuid))
          ORDER BY created_at,id LIMIT 51`,
        [input.status, input.afterCreatedAt ?? null, input.afterId ?? null],
      );
      const rows = result.rows.slice(0, 50);
      const last = rows.at(-1);
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'support.queue_viewed',$1,$2)",
        [actor.id, JSON.stringify({ status: input.status, count: rows.length })],
      );
      return SupportQueue.parse({
        requests: rows.map((row) => ({
          id: row.id,
          category: row.category,
          status: row.status,
          createdAt: row.created_at.toISOString(),
        })),
        nextCursor:
          result.rows.length > 50 && last ? { afterCreatedAt: last.cursor_time, afterId: last.id } : null,
      });
    });
  }
  async resolve(actor: Actor, requestId: string, raw: unknown, key: string) {
    const input = SupportResolution.parse(raw);
    const authorize = async (client: PoolClient) => {
      await requireStaffPermission(client, actor, 'support.read');
      await requireStaffPermission(client, actor, 'support.resolve');
    };
    await transaction(this.pool, authorize);
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'support.resolve', requestId, ...input },
      async (client) => {
        await authorize(client);
        const found = await client.query('SELECT id,status FROM support_requests WHERE id=$1 FOR UPDATE', [
          requestId,
        ]);
        if (!found.rows[0]) throw new DomainError('NOT_FOUND', 'Support request not found.', 404);
        if (found.rows[0].status !== 'open')
          throw new DomainError(
            'SUPPORT_RESOLVED',
            'This request was already resolved. Reload before continuing.',
            409,
          );
        const result = await client.query(
          "UPDATE support_requests SET status='resolved',response=$2,resolved_at=now(),resolved_by=$3 WHERE id=$1 RETURNING id,category,message,status,created_at,response,resolved_at",
          [requestId, input.response, actor.id],
        );
        await client.query(
          "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'support.resolved',$2,'{}')",
          [actor.id, requestId],
        );
        return dto(result.rows[0]);
      },
    );
  }
  async inspect(actor: Actor, requestId: string) {
    return transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, 'support.read');
      const result = await client.query(
        'SELECT id,category,message,status,created_at,response,resolved_at FROM support_requests WHERE id=$1',
        [requestId],
      );
      if (!result.rows[0]) throw new DomainError('NOT_FOUND', 'Support request not found.', 404);
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'support.viewed',$2,'{}')",
        [actor.id, requestId],
      );
      return dto(result.rows[0]);
    });
  }
}

async function recordDeletionConsent(client: PoolClient, actor: Actor, supportRequestId: string) {
  // owner() serializes all submissions. Consent and its audit commit with the ticket.
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO account_deletion_requests(owner_id,support_request_id,consent_version)
     VALUES($1,$2,'account-deletion-v1') ON CONFLICT(owner_id) DO NOTHING RETURNING id`,
    [actor.id, supportRequestId],
  );
  if (inserted.rows[0])
    await client.query(
      "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'account_deletion.requested',$2,$3)",
      [actor.id, inserted.rows[0].id, JSON.stringify({ consentVersion: 'account-deletion-v1' })],
    );
}
