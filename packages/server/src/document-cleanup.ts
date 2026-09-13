import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import {
  DocumentCleanupApproval,
  DocumentCleanupPlan,
  DocumentStorageInspection,
  DocumentUploadInspection,
} from '@rove/contracts';
import type { Actor } from './rides';
import type { JobHandler } from './outbox';
import type { DocumentObjectVersion } from './s3-document-inventory';
import type { DocumentErasureTarget } from './s3-document-erasure';
import { assertNoRetentionHolds } from './retention-holds';
import { assertDocumentWritesSettled } from './document-storage-writes';
import { requireStaffPermission } from './staff-access';
import { transaction, command } from './transactions';
import { DomainError } from './errors';
export interface DocumentCleanupProvider {
  discover(documentId: string): Promise<DocumentObjectVersion[]>;
  erase(target: DocumentErasureTarget): Promise<{ status: 'absent' }>;
}
const Entry = z
  .object({
    documentId: z.uuid(),
    key: z.string().max(300),
    version: z
      .string()
      .min(1)
      .max(1024)
      .refine((v) => v !== 'null'),
    kind: z.enum(['object', 'delete_marker']),
  })
  .strict();
const select = `SELECT p.*,count(i.id)::int AS objects,count(i.removed_at)::int AS removed,count(i.attempted_at)::int AS attempted
 FROM document_cleanup_plans p LEFT JOIN document_cleanup_items i ON i.plan_id=p.id WHERE p.id=$1 GROUP BY p.id`;
function dto(r: Record<string, unknown>) {
  return DocumentCleanupPlan.parse({
    id: r.id,
    documentId: r.document_id,
    ownerId: r.owner_id,
    manifestHash: r.manifest_hash,
    createdAt: (r.created_at as Date).toISOString(),
    approvedAt: r.approved_at ? (r.approved_at as Date).toISOString() : null,
    notBefore: r.not_before ? (r.not_before as Date).toISOString() : null,
    objects: r.objects,
    removed: r.removed,
    attempted: r.attempted,
    deleteMarkers: r.delete_markers,
    state: !r.approved_at ? 'draft' : r.objects === r.removed ? 'versions_removed' : 'approved',
  });
}
/** Durable per-document cleanup. versions_removed never asserts account-wide or backup erasure. */
export class DocumentCleanup {
  constructor(
    private pool: Pool,
    private provider: DocumentCleanupProvider,
    private policyReference: string,
  ) {
    DocumentCleanupApproval.shape.policyReference.parse(policyReference);
  }
  private async ready(c: PoolClient, ownerId: string) {
    await assertDocumentWritesSettled(c, ownerId);
    await assertNoRetentionHolds(c, ownerId);
  }
  async inspectUploads(actor: Actor, documentId: string, after?: string) {
    z.uuid().parse(documentId);
    const prefix = `driver-documents/quarantine/${documentId}/`;
    if (
      after !== undefined &&
      (!after.startsWith(prefix) || !z.uuid().safeParse(after.slice(prefix.length)).success)
    )
      throw new DomainError('INVALID_DOCUMENT', 'Invalid upload inspection cursor.', 422);
    return transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, 'privacy.read');
      // One statement keeps reservation/access state and pending evidence in the same snapshot.
      const row = (
        await c.query(
          `SELECT d.expires_at,d.expires_at>statement_timestamp() AS reservation_active,
        u.disabled AND EXISTS(SELECT 1 FROM account_closures a WHERE a.owner_id=u.id) AS access_closed,
        COALESCE((SELECT jsonb_agg(x ORDER BY x.object_key) FROM
          (SELECT w.object_key,w.started_at FROM document_storage_writes w
           WHERE w.document_id=d.id AND w.settled_at IS NULL AND w.not_dispatched_at IS NULL AND w.object_key>$2
           ORDER BY w.object_key LIMIT 101) x),'[]'::jsonb) AS pending
        FROM driver_documents d JOIN users u ON u.id=d.driver_id WHERE d.id=$1`,
          [documentId, after ?? ''],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Document not found.', 404);
      const pending = row.pending as { object_key: string; started_at: string }[];
      const page = pending.slice(0, 100);
      const result = DocumentUploadInspection.parse({
        documentId,
        accessClosed: row.access_closed,
        reservationExpiresAt: row.expires_at.toISOString(),
        reservationActive: row.reservation_active,
        pendingWrites: page.map((w) => ({
          key: w.object_key,
          startedAt: new Date(w.started_at).toISOString(),
        })),
        nextCursor: pending.length > 100 ? page.at(-1)!.object_key : null,
      });
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'document.uploads_inspected',$2,'{}')",
        [actor.id, documentId],
      );
      return result;
    });
  }
  private async inventory(documentId: string) {
    const inventory = z
      .array(Entry)
      .max(10000)
      .parse(await this.provider.discover(documentId));
    const seen = new Set<string>();
    for (const row of inventory) {
      const path = row.key.split('/');
      const identity = JSON.stringify([row.key, row.version]);
      if (
        row.documentId !== documentId ||
        path.length !== 4 ||
        path[0] !== 'driver-documents' ||
        !['inbox', 'quarantine'].includes(path[1]!) ||
        path[2] !== documentId ||
        !z.uuid().safeParse(path[3]).success ||
        seen.has(identity)
      )
        throw new DomainError(
          'DOCUMENT_INVENTORY_UNAVAILABLE',
          'Document inventory scope is not verified.',
          503,
        );
      seen.add(identity);
    }
    inventory.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
    return { inventory, manifestHash: createHash('sha256').update(JSON.stringify(inventory)).digest('hex') };
  }
  /** A fresh observation, never a quiescence or account-erasure certificate. */
  async inspectStorage(actor: Actor, documentId: string) {
    z.uuid().parse(documentId);
    const authorize = async (c: PoolClient) => {
      await requireStaffPermission(c, actor, 'privacy.read');
      if (!(await c.query('SELECT id FROM driver_documents WHERE id=$1', [documentId])).rowCount)
        throw new DomainError('NOT_FOUND', 'Document not found.', 404);
    };
    await transaction(this.pool, authorize);
    const startedAt = new Date().toISOString();
    // No database locks are held while requesting the complete provider inventory.
    const { inventory, manifestHash } = await this.inventory(documentId);
    const result = DocumentStorageInspection.parse({
      documentId,
      startedAt,
      observedAt: new Date().toISOString(),
      manifestHash,
      objectVersions: inventory.filter((entry) => entry.kind === 'object').length,
      deleteMarkers: inventory.filter((entry) => entry.kind === 'delete_marker').length,
    });
    return transaction(this.pool, async (c) => {
      // Permissions can be revoked during provider I/O; fail before returning evidence.
      await authorize(c);
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'document.storage_inspected',$2,$3)",
        [actor.id, documentId, JSON.stringify(result)],
      );
      return result;
    });
  }
  async prepare(actor: Actor, documentId: string, key: string) {
    z.uuid().parse(documentId);
    const ownerId = await transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, 'privacy.cleanup');
      const row = (await c.query('SELECT driver_id FROM driver_documents WHERE id=$1', [documentId])).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Document not found.', 404);
      await this.ready(c, row.driver_id);
      return row.driver_id as string;
    });
    const { inventory, manifestHash } = await this.inventory(documentId);
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'document.cleanup-prepare', documentId },
      async (c) => {
        await requireStaffPermission(c, actor, 'privacy.cleanup');
        await this.ready(c, ownerId);
        const document = (
          await c.query('SELECT driver_id FROM driver_documents WHERE id=$1 FOR SHARE', [documentId])
        ).rows[0];
        if (document?.driver_id !== ownerId)
          throw new DomainError('DOCUMENT_CONFLICT', 'Document ownership changed.', 409);
        const plan = (
          await c.query(
            'INSERT INTO document_cleanup_plans(document_id,owner_id,manifest_hash,delete_markers,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
            [
              documentId,
              ownerId,
              manifestHash,
              inventory.filter((r) => r.kind === 'delete_marker').length,
              actor.id,
            ],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO document_cleanup_items(plan_id,object_key,object_version)
        SELECT $1,key,version FROM jsonb_to_recordset($2::jsonb) AS x(key text,version text)`,
          [plan.id, JSON.stringify(inventory.filter((r) => r.kind === 'object'))],
        );
        await c.query(
          "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'document.cleanup_prepared',$2,$3)",
          [
            actor.id,
            plan.id,
            JSON.stringify({ manifestHash, objects: inventory.filter((r) => r.kind === 'object').length }),
          ],
        );
        return dto((await c.query(select, [plan.id])).rows[0]);
      },
    );
  }
  async inspect(actor: Actor, planId: string) {
    z.uuid().parse(planId);
    return transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, 'privacy.read');
      const row = (await c.query(select, [planId])).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', 'Cleanup plan not found.', 404);
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'document.cleanup_viewed',$2,'{}')",
        [actor.id, planId],
      );
      return dto(row);
    });
  }
  async approve(actor: Actor, planId: string, raw: unknown, key: string) {
    z.uuid().parse(planId);
    const input = DocumentCleanupApproval.parse(raw);
    if (input.policyReference !== this.policyReference)
      throw new DomainError('CLEANUP_POLICY', 'Use the configured approved cleanup policy.', 409);
    await transaction(this.pool, (c) => requireStaffPermission(c, actor, 'privacy.cleanup'));
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'document.cleanup-approve', planId, ...input },
      async (c) => {
        await requireStaffPermission(c, actor, 'privacy.cleanup');
        const initial = (await c.query('SELECT owner_id FROM document_cleanup_plans WHERE id=$1', [planId]))
          .rows[0];
        if (!initial) throw new DomainError('NOT_FOUND', 'Cleanup plan not found.', 404);
        await this.ready(c, initial.owner_id);
        const plan = (
          await c.query(
            'SELECT *,not_before=$2::timestamptz AS same_time FROM document_cleanup_plans WHERE id=$1 FOR UPDATE',
            [planId, input.notBefore],
          )
        ).rows[0];
        if (plan.manifest_hash !== input.manifestHash)
          throw new DomainError('CLEANUP_MANIFEST_CHANGED', 'Review this exact cleanup manifest.', 409);
        if (plan.approved_at) {
          if (
            plan.policy_reference !== input.policyReference ||
            plan.review_reference !== input.reviewReference ||
            plan.quiescence_reference !== input.quiescenceReference ||
            !plan.same_time
          )
            throw new DomainError(
              'CLEANUP_ALREADY_APPROVED',
              'This plan already has immutable approval.',
              409,
            );
          return dto((await c.query(select, [planId])).rows[0]);
        }
        await c.query(
          'UPDATE document_cleanup_plans SET approved_at=clock_timestamp(),approved_by=$2,policy_reference=$3,review_reference=$4,quiescence_reference=$5,not_before=$6 WHERE id=$1',
          [
            planId,
            actor.id,
            input.policyReference,
            input.reviewReference,
            input.quiescenceReference,
            input.notBefore,
          ],
        );
        await c.query(
          `INSERT INTO outbox(topic,aggregate_id,payload,dedupe_key,available_at)
        SELECT 'document.version-delete',id,'{}'::jsonb,'document.version-delete:'||id::text,$2::timestamptz FROM document_cleanup_items WHERE plan_id=$1`,
          [planId, input.notBefore],
        );
        await c.query(
          "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'document.cleanup_approved',$2,$3)",
          [actor.id, planId, JSON.stringify(input)],
        );
        return dto((await c.query(select, [planId])).rows[0]);
      },
    );
  }
  async retry(actor: Actor, planId: string, key: string) {
    z.uuid().parse(planId);
    await transaction(this.pool, (c) => requireStaffPermission(c, actor, 'privacy.cleanup'));
    return command(this.pool, actor.id, key, { action: 'document.cleanup-retry', planId }, async (c) => {
      await requireStaffPermission(c, actor, 'privacy.cleanup');
      const plan = (await c.query('SELECT * FROM document_cleanup_plans WHERE id=$1', [planId])).rows[0];
      if (!plan?.approved_at)
        throw new DomainError('CLEANUP_NOT_AUTHORIZED', 'Approve cleanup before retrying.', 409);
      await this.ready(c, plan.owner_id);
      const changed = await c.query(
        `UPDATE outbox o SET dead_letter_at=NULL,attempts=0,available_at=GREATEST(clock_timestamp(),$2::timestamptz),last_error_code=NULL
        FROM document_cleanup_items i WHERE i.plan_id=$1 AND i.removed_at IS NULL AND o.dedupe_key='document.version-delete:'||i.id::text
        AND o.completed_at IS NULL AND o.dead_letter_at IS NOT NULL AND (o.locked_until IS NULL OR o.locked_until<=clock_timestamp()) RETURNING o.id`,
        [planId, plan.not_before],
      );
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'document.cleanup_retry',$2,$3)",
        [actor.id, planId, JSON.stringify({ requeued: changed.rowCount ?? 0 })],
      );
      return { requeued: changed.rowCount ?? 0 };
    });
  }
  readonly handle: JobHandler = async (job) => {
    await this.removeVersion(job.aggregateId);
  };
  async removeVersion(itemId: string) {
    z.uuid().parse(itemId);
    const target = await transaction(this.pool, async (c) => {
      const initial = (
        await c.query(
          'SELECT p.owner_id,i.removed_at FROM document_cleanup_items i JOIN document_cleanup_plans p ON p.id=i.plan_id WHERE i.id=$1',
          [itemId],
        )
      ).rows[0];
      if (!initial) throw new DomainError('NOT_FOUND', 'Cleanup item not found.', 404);
      if (initial.removed_at) return null;
      await this.ready(c, initial.owner_id);
      const row = (
        await c.query(
          `SELECT i.*,p.document_id,p.approved_at,p.not_before<=clock_timestamp() AS due FROM document_cleanup_items i JOIN document_cleanup_plans p ON p.id=i.plan_id WHERE i.id=$1 FOR UPDATE OF i FOR SHARE OF p`,
          [itemId],
        )
      ).rows[0];
      if (!row.approved_at || !row.due)
        throw new DomainError('CLEANUP_NOT_AUTHORIZED', 'Cleanup approval is not due.', 409);
      if (row.removed_at) return null;
      await c.query(
        'UPDATE document_cleanup_items SET attempted_at=COALESCE(attempted_at,clock_timestamp()) WHERE id=$1',
        [itemId],
      );
      return {
        documentId: row.document_id as string,
        key: row.object_key as string,
        version: row.object_version as string,
      };
    });
    if (!target) return;
    const result = await this.provider.erase(target);
    if (result?.status !== 'absent')
      throw new DomainError('DOCUMENT_ERASURE_UNAVAILABLE', 'Document version removal is not verified.', 503);
    await transaction(this.pool, async (c) => {
      const row = (await c.query('SELECT * FROM document_cleanup_items WHERE id=$1 FOR UPDATE', [itemId]))
        .rows[0];
      if (!row || row.object_key !== target.key || row.object_version !== target.version)
        throw new DomainError('CLEANUP_MANIFEST_CHANGED', 'Cleanup reference changed.', 409);
      if (row.removed_at) return;
      // A later hold blocks new dispatch, not truthful evidence of the earlier request.
      await c.query('UPDATE document_cleanup_items SET removed_at=clock_timestamp() WHERE id=$1', [itemId]);
      await c.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES(NULL,'document.version_removed',$1,'{}')",
        [itemId],
      );
    });
  }
}
