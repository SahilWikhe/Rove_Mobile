import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { DriverDocumentReviewDecision, DriverDocumentReviewResult } from '@rove/contracts';
import type { Actor } from './rides';
import { requireStaffPermission } from './staff-access';
import { command, transaction } from './transactions';
import { DomainError } from './errors';

const authorize = (client: PoolClient, actor: Actor) =>
  requireStaffPermission(client, actor, 'driver.document.review');

/** Records a staff document decision, never overall driver eligibility or payout readiness. */
export class DocumentReviewService {
  constructor(private pool: Pool) {}

  async list(actor: Actor, rawDriverId: string) {
    const driverId = z.uuid().parse(rawDriverId);
    return transaction(this.pool, async (client) => {
      await authorize(client, actor);
      const rows = await client.query(
        `SELECT d.id,d.kind,d.state,d.created_at,
          CASE WHEN d.state='quarantined' AND r.document_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM driver_documents newer
              WHERE newer.driver_id=d.driver_id AND newer.kind=d.kind AND newer.state='quarantined'
                AND (newer.created_at,newer.id)>(d.created_at,d.id))
            AND s.state='clean' AND s.scanned_key=d.object_key
            AND s.scanned_version=d.object_version AND s.scanned_sha256=d.expected_sha256
            THEN true ELSE false END AS ready_for_review
         FROM driver_documents d LEFT JOIN driver_document_scans s ON s.document_id=d.id
         LEFT JOIN driver_document_reviews r ON r.document_id=d.id
         WHERE d.driver_id=$1 ORDER BY d.created_at DESC,d.id DESC LIMIT 30`,
        [driverId],
      );
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'staff.documents_listed',$2,'{}')",
        [actor.id, driverId],
      );
      return {
        documents: rows.rows.map((row) => ({
          id: row.id as string,
          kind: row.kind as string,
          state: row.state as string,
          createdAt: (row.created_at as Date).toISOString(),
          readyForReview: row.ready_for_review as boolean,
        })),
      };
    });
  }

  async decide(actor: Actor, rawDocumentId: string, raw: unknown, key: string) {
    const documentId = z.uuid().parse(rawDocumentId);
    const input = DriverDocumentReviewDecision.parse(raw);
    // A revoked reviewer cannot retrieve an old command result.
    await transaction(this.pool, (client) => authorize(client, actor));
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'document.review', documentId, ...input },
      async (client) => {
        await authorize(client, actor);
        // Same driver lock as intake completion, so a replacement cannot race this decision.
        const owner = (
          await client.query(
            'SELECT d.id,u.disabled FROM drivers d JOIN users u ON u.id=d.id JOIN driver_documents x ON x.driver_id=d.id WHERE x.id=$1 FOR UPDATE OF d,u',
            [documentId],
          )
        ).rows[0];
        if (!owner || owner.disabled)
          throw new DomainError('NOT_FOUND', 'This document is unavailable for review.', 404);
        const document = (
          await client.query('SELECT * FROM driver_documents WHERE id=$1 FOR UPDATE', [documentId])
        ).rows[0];
        const scan = (
          await client.query('SELECT * FROM driver_document_scans WHERE document_id=$1 FOR SHARE', [
            documentId,
          ])
        ).rows[0];
        if (
          document.state !== 'quarantined' ||
          scan?.state !== 'clean' ||
          scan.scanned_key !== document.object_key ||
          scan.scanned_version !== document.object_version ||
          scan.scanned_sha256 !== document.expected_sha256
        )
          throw new DomainError(
            'DOCUMENT_NOT_REVIEWABLE',
            'Wait for a verified clean scan before reviewing this file.',
            409,
          );
        const latest = (
          await client.query(
            "SELECT id FROM driver_documents WHERE driver_id=$1 AND kind=$2 AND state='quarantined' ORDER BY created_at DESC,id DESC LIMIT 1",
            [owner.id, document.kind],
          )
        ).rows[0];
        if (latest?.id !== documentId)
          throw new DomainError('DOCUMENT_REPLACED', 'Review the latest uploaded document.', 409);
        if (
          (await client.query('SELECT 1 FROM driver_document_reviews WHERE document_id=$1', [documentId]))
            .rowCount
        )
          throw new DomainError(
            'DOCUMENT_ALREADY_REVIEWED',
            'A decision is already recorded for this document.',
            409,
          );
        const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
        if (input.decision === 'approved' && new Date(input.expiresAt) <= now)
          throw new DomainError(
            'DOCUMENT_EXPIRED',
            'An approved document must have a future expiry date.',
            422,
          );
        const saved = (
          await client.query(
            `INSERT INTO driver_document_reviews(document_id,reviewer_id,decision,reason,expires_at,reviewed_at,object_key,object_version,sha256)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              documentId,
              actor.id,
              input.decision,
              input.decision === 'rejected' ? input.reason : null,
              input.decision === 'approved' ? input.expiresAt : null,
              now,
              document.object_key,
              document.object_version,
              document.expected_sha256,
            ],
          )
        ).rows[0];
        await client.query(
          "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'staff.document_reviewed',$2,$3)",
          [actor.id, documentId, JSON.stringify({ decision: input.decision })],
        );
        return DriverDocumentReviewResult.parse({
          documentId,
          status: saved.decision,
          reason: saved.reason,
          expiresAt: saved.expires_at?.toISOString() ?? null,
          reviewedAt: saved.reviewed_at.toISOString(),
        });
      },
    );
  }
}
