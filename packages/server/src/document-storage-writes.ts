import { appendAudit } from './audit';
import { bindActorIdentity } from './actor-transaction';
import { DocumentWriteNotDispatched } from './document-write-not-dispatched';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import type { DocumentQuarantineStore } from './document-intake';
import type { Actor } from './rides';
import { transaction } from './transactions';
import { DomainError } from './errors';
import { driverOnly } from './drivers';

/** Records writes before provider I/O, including attempts that never attach to a document. */
export function trackedDocumentStore(
  pool: Pool,
  actor: Actor,
  documentId: string,
  store: DocumentQuarantineStore,
): DocumentQuarantineStore {
  return {
    async put(input) {
      driverOnly(actor);
      z.uuid().parse(documentId);
      const prefix = `driver-documents/quarantine/${documentId}/`;
      if (!input.key.startsWith(prefix) || !z.uuid().safeParse(input.key.slice(prefix.length)).success)
        throw new DomainError('INVALID_DOCUMENT', 'Invalid document storage reference.', 422);
      await transaction(pool, async (c) => {
        // Account closure uses driver then user locks. No network I/O under either lock.
        await c.query('SELECT id FROM drivers WHERE id=$1 FOR UPDATE', [actor.id]);
        const account = (
          await c.query("SELECT id FROM users WHERE id=$1 AND role='driver' AND NOT disabled FOR UPDATE", [
            actor.id,
          ])
        ).rows[0];
        if (!account) throw new DomainError('FORBIDDEN', 'This account cannot submit documents.', 403);
        await bindActorIdentity(c, actor, 'update');
        const row = (
          await c.query(
            "SELECT * FROM driver_documents WHERE id=$1 AND driver_id=$2 AND state='reserved' AND expires_at>clock_timestamp() FOR UPDATE",
            [documentId, actor.id],
          )
        ).rows[0];
        if (!row) throw new DomainError('DOCUMENT_CONFLICT', 'This upload is no longer available.', 409);
        if (
          row.expected_sha256 !== input.sha256 ||
          row.expected_bytes !== input.body.byteLength ||
          row.content_type !== input.contentType ||
          input.ifAbsent !== true
        )
          throw new DomainError('INVALID_DOCUMENT', 'The stored file does not match its reservation.', 422);
        await c.query('INSERT INTO document_storage_writes(object_key,document_id) VALUES($1,$2)', [
          input.key,
          documentId,
        ]);
        await appendAudit(c, actor.id, 'driver.document_write_dispatched', documentId, '{}');
      });
      // Only explicit pre-dispatch proof clears a failed intent; a timeout may have stored bytes.
      let receipt;
      try {
        receipt = await store.put(input);
      } catch (error) {
        if (error instanceof DocumentWriteNotDispatched) {
          await persistOutcome(pool, actor, documentId, input.key, { kind: 'not_dispatched' });
        }
        throw error;
      }
      const result = z
        .object({
          version: z
            .string()
            .min(1)
            .max(1024)
            .refine((v) => v !== 'null'),
          sha256: z.literal(input.sha256),
          bytes: z.literal(input.body.byteLength),
        })
        .parse(receipt);
      await persistOutcome(pool, actor, documentId, input.key, { kind: 'stored', version: result.version });
      return result;
    },
  };
}

/** Retry only persistence of a definitive outcome held by this request, never provider I/O. */
async function persistOutcome(
  pool: Pool,
  actor: Actor,
  documentId: string,
  key: string,
  outcome: { kind: 'stored'; version: string } | { kind: 'not_dispatched' },
) {
  const transientCodes = new Set([
    '40001',
    '40P01',
    '08000',
    '08003',
    '08006',
    '08007',
    '57P01',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
  ]);
  for (let attempt = 0; ; attempt++) {
    try {
      await transaction(pool, async (c) => {
        // This receipt belongs to an already dispatched write and must survive account closure.
        // Scope is derived from the trusted request's validated reservation and storage key.
        await c.query(
          "SELECT set_config('rove.actor_id','',true),set_config('rove.actor_role','',true),set_config('rove.actor_mfa','false',true),set_config('rove.outbox_append','',true),set_config('rove.outbox_work','',true),set_config('rove.outbox_identity_request','',true),set_config('rove.outbox_cleanup_plan','',true),set_config('rove.ledger_attempt','',true),set_config('rove.ledger_owner','',true),set_config('rove.ledger_append','',true),set_config('rove.offer_ride','',true),set_config('rove.offer_matching','false',true),set_config('rove.quote_owner','',true),set_config('rove.quote_ride','',true),set_config('rove.command_actor','',true),set_config('rove.command_key','',true),set_config('rove.command_fingerprint','',true),set_config('rove.tracking_mode','',true),set_config('rove.tracking_hash','',true),set_config('rove.tracking_driver','',true),set_config('rove.tracking_close_owner','',true),set_config('rove.payment_webhook_source','',true),set_config('rove.payment_webhook_event','',true),set_config('rove.payout_webhook_source','',true),set_config('rove.payout_webhook_event','',true),set_config('rove.payout_source','',true),set_config('rove.payout_driver','',true),set_config('rove.payout_account','',true),set_config('rove.payout_binding','',true),set_config('rove.payout_result','',true),set_config('rove.payout_sweep','false',true),set_config('rove.transfer_source','',true),set_config('rove.transfer_attempt','',true),set_config('rove.transfer_read','',true),set_config('rove.transfer_write','',true),set_config('rove.transfer_sweep','false',true),set_config('rove.transfer_balance','',true),set_config('rove.transfer_closure_owner','',true),set_config('rove.loss_source','',true),set_config('rove.loss_attempt','',true),set_config('rove.loss_journal','',true),set_config('rove.refund_operation_source','',true),set_config('rove.refund_operation_attempt','',true),set_config('rove.refund_operation_read','',true),set_config('rove.refund_operation_write','',true),set_config('rove.refund_closure_owner','',true),set_config('rove.dispute_source','',true),set_config('rove.dispute_read','',true),set_config('rove.dispute_write','',true),set_config('rove.dispute_sweep','false',true),set_config('rove.refund_source','',true),set_config('rove.refund_read','',true),set_config('rove.refund_write','',true),set_config('rove.refund_sweep','false',true),set_config('rove.customer_source','',true),set_config('rove.customer_read','',true),set_config('rove.customer_write','',true),set_config('rove.customer_result','',true),set_config('rove.capture_source','',true),set_config('rove.capture_write','',true),set_config('rove.capture_read','',true),set_config('rove.capture_sweep','false',true),set_config('rove.capture_balance','',true),set_config('rove.install_project','',true),set_config('rove.install_lookup','',true),set_config('rove.install_token','',true),set_config('rove.install_target','',true),set_config('rove.install_revision','',true),set_config('rove.audience_rider','',true),set_config('rove.audience_rider_project','',true),set_config('rove.audience_driver','',true),set_config('rove.audience_driver_project','',true),set_config('rove.push_event','',true),set_config('rove.push_installation','',true),set_config('rove.push_revision','',true),set_config('rove.push_delivery','',true),set_config('rove.push_recovery_at','',true),set_config('rove.push_rate_project','',true),set_config('rove.rate_key','',true),set_config('rove.rate_prune','false',true),set_config('rove.identity_request','',true),set_config('rove.notification_message','',true),set_config('rove.notification_offer','',true),set_config('rove.closure_guard_owner','',true),set_config('rove.retention_owner','',true),set_config('rove.cleanup_item','',true),set_config('rove.scan_queue','false',true),set_config('rove.scan_document','',true),set_config('rove.write_document',$1,true),set_config('rove.write_key',$2,true)",
          [documentId, key],
        );
        const row = (
          await c.query(
            'SELECT * FROM document_storage_writes WHERE object_key=$1 AND document_id=$2 FOR UPDATE',
            [key, documentId],
          )
        ).rows[0];
        if (!row) throw new DomainError('DOCUMENT_CONFLICT', 'Document write evidence is missing.', 409);
        // A lost COMMIT response can mean both the receipt and its audit already exist.
        if (row.settled_at || row.not_dispatched_at) {
          const same =
            outcome.kind === 'stored'
              ? row.settled_at && row.object_version === outcome.version && !row.not_dispatched_at
              : row.not_dispatched_at && !row.settled_at && row.object_version === null;
          if (!same) throw new DomainError('DOCUMENT_CONFLICT', 'Document write outcome conflicts.', 409);
          return;
        }
        if (outcome.kind === 'stored') {
          await c.query(
            'UPDATE document_storage_writes SET settled_at=clock_timestamp(),object_version=$2 WHERE object_key=$1',
            [key, outcome.version],
          );
        } else {
          await c.query(
            'UPDATE document_storage_writes SET not_dispatched_at=clock_timestamp() WHERE object_key=$1',
            [key],
          );
        }
        await appendAudit(
          c,
          actor.id,
          outcome.kind === 'stored'
            ? 'driver.document_write_settled'
            : 'driver.document_write_not_dispatched',
          documentId,
          '{}',
        );
      });
      return;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (attempt >= 2 || typeof code !== 'string' || !transientCodes.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

/** Necessary cleanup barrier; callers must also check retention policy/holds and storage rediscovery. */
export async function assertDocumentWritesSettled(c: PoolClient, ownerId: string) {
  const owner = (await c.query('SELECT disabled FROM users WHERE id=$1 FOR UPDATE', [ownerId])).rows[0];
  if (
    !owner?.disabled ||
    !(await c.query('SELECT request_id FROM account_closures WHERE owner_id=$1', [ownerId])).rowCount
  )
    throw new DomainError('ACCOUNT_CLOSURE_REQUIRED', 'Close account access before document cleanup.', 409);
  const blocked = await c.query(
    `SELECT d.id FROM driver_documents d WHERE d.driver_id=$1
    AND (d.expires_at>clock_timestamp() OR EXISTS(SELECT 1 FROM document_storage_writes w WHERE w.document_id=d.id AND w.settled_at IS NULL AND w.not_dispatched_at IS NULL)) LIMIT 1`,
    [ownerId],
  );
  if (blocked.rowCount)
    throw new DomainError(
      'DOCUMENT_WRITES_PENDING',
      'Document uploads require settlement before cleanup.',
      409,
    );
}
