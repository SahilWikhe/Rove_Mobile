import { z } from 'zod';
import { MessageCleanupAuthorization } from '@rove/contracts';
import type { Pool } from 'pg';
import type { Actor } from './rides';
import { DomainError } from './errors';
import { command, transaction } from './transactions';
import { requireStaffPermission } from './staff-access';
import { assertNoRetentionHolds } from './retention-holds';

/** Explicit reviewed batches only. No default retention policy or automatic scheduling. */
export class MessageCleanup {
  constructor(
    private pool: Pool,
    private policyReference?: string,
  ) {}

  async erase(actor: Actor, requestId: string, raw: unknown, key: string) {
    z.uuid().parse(requestId);
    const input = MessageCleanupAuthorization.parse(raw);
    if (!this.policyReference || input.policyReference !== this.policyReference)
      throw new DomainError('CLEANUP_DISABLED', 'A configured cleanup policy is required.', 409);
    await transaction(this.pool, (c) => requireStaffPermission(c, actor, 'privacy.cleanup'));
    return command(this.pool, actor.id, key, { action: 'messages.erase', requestId, ...input }, async (c) => {
      await requireStaffPermission(c, actor, 'privacy.cleanup');
      const request = (
        await c.query('SELECT owner_id FROM account_deletion_requests WHERE id=$1', [requestId])
      ).rows[0];
      if (!request) throw new DomainError('NOT_FOUND', 'Deletion request not found.', 404);
      // Discover participants without bodies. Lock all participant users before rides, as messaging does.
      const targets = await c.query<{
        id: string;
        ride_id: string;
        rider_id: string;
        driver_id: string;
        current_driver: string | null;
      }>(
        `SELECT m.id,o.ride_id,r.rider_id,o.driver_id,r.driver_id AS current_driver
        FROM trip_messages m JOIN offers o ON o.id=m.offer_id JOIN rides r ON r.id=o.ride_id
        WHERE m.id=ANY($1::uuid[]) AND m.sender_id=$2`,
        [input.messageIds, request.owner_id],
      );
      if (targets.rowCount !== input.messageIds.length)
        throw new DomainError('CLEANUP_SCOPE', 'The reviewed message batch no longer matches.', 409);
      const participants = new Set<string>([request.owner_id]);
      for (const row of targets.rows) {
        participants.add(row.rider_id);
        participants.add(row.driver_id);
        if (row.current_driver) participants.add(row.current_driver);
      }
      for (const id of [...participants].sort()) await assertNoRetentionHolds(c, id);
      const closure = await c.query(
        `SELECT a.owner_id FROM account_deletion_requests a JOIN account_closures x ON x.request_id=a.id
        JOIN users u ON u.id=a.owner_id WHERE a.id=$1 AND a.withdrawn_at IS NULL AND u.disabled=true
        AND x.closed_at IS NOT NULL FOR UPDATE OF a`,
        [requestId],
      );
      if (!closure.rowCount)
        throw new DomainError('CLEANUP_NOT_CLOSED', 'Reviewed account closure is required.', 409);
      await c.query('SELECT id FROM rides WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
        [...new Set(targets.rows.map((r) => r.ride_id))],
      ]);
      // Recheck after locks. Reports never expire automatically; a counterpart hold protects the conversation.
      const eligible = await c.query(
        `SELECT m.id FROM trip_messages m JOIN offers o ON o.id=m.offer_id JOIN rides r ON r.id=o.ride_id
        WHERE m.id=ANY($1::uuid[]) AND m.sender_id=$2
        AND m.created_at<$3::timestamptz AND m.created_at<now()-interval '30 days'
        AND r.state IN ('completed','cancelled','no_driver_found')
        AND NOT EXISTS(SELECT 1 FROM trip_message_reports p WHERE p.offer_id=o.id)
        AND (r.driver_id IS NULL OR r.driver_id=ANY($4::uuid[])) FOR UPDATE OF m`,
        [input.messageIds, request.owner_id, input.createdBefore, [...participants]],
      );
      if (eligible.rowCount !== input.messageIds.length)
        throw new DomainError('CLEANUP_RETAINED', 'A reviewed message is still protected or in use.', 409);
      await c.query('DELETE FROM trip_messages WHERE id=ANY($1::uuid[])', [input.messageIds]);
      const receipt = {
        requestId,
        removedMessages: input.messageIds.length,
        completeErasureVerified: false as const,
      };
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'account_deletion.messages_erased',$2,$3)",
        [actor.id, requestId, JSON.stringify({ ...input, removedMessages: receipt.removedMessages })],
      );
      return receipt;
    });
  }
}
