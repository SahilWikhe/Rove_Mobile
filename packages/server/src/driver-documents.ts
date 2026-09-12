import { trackedDocumentStore } from './document-storage-writes';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { quarantineDriverDocument, type DocumentQuarantineStore } from './document-intake';
import type { Pool } from 'pg';
import type { Actor } from './rides';
import { driverOnly } from './drivers';
import { transaction } from './transactions';
import { DomainError } from './errors';
import {
  DriverDocumentReservation as Reservation,
  DriverDocumentSummary as Summary,
  DriverDocumentUploadTarget,
} from '@rove/contracts';

export interface DriverDocumentTransfers {
  forms: {
    issue(
      input: z.infer<typeof Reservation> & { expiresAt: string },
    ): Promise<z.infer<typeof DriverDocumentUploadTarget>>;
  };
  inbox: { read(input: z.infer<typeof Reservation> & { key: string }): Promise<Uint8Array> };
  quarantine: DocumentQuarantineStore;
}

/** Metadata only. Returned summaries intentionally exclude keys, checksums and private storage versions. */
export class DriverDocumentService {
  constructor(
    private pool: Pool,
    private transfers?: DriverDocumentTransfers,
  ) {}
  async reserve(actor: Actor, raw: unknown) {
    driverOnly(actor);
    const input = Reservation.parse(raw);
    return transaction(this.pool, async (client) => {
      // Serialize quotas and account state with other driver mutations.
      const driver = (
        await client.query(
          'SELECT d.id,u.disabled FROM drivers d JOIN users u ON u.id=d.id WHERE d.id=$1 FOR UPDATE OF d,u',
          [actor.id],
        )
      ).rows[0];
      if (!driver || driver.disabled)
        throw new DomainError('FORBIDDEN', 'This account cannot submit documents.', 403);
      const prior = (await client.query('SELECT * FROM driver_documents WHERE id=$1', [input.id])).rows[0];
      if (prior) {
        if (prior.driver_id !== actor.id)
          throw new DomainError(
            'DOCUMENT_CONFLICT',
            'This upload request is unavailable. Start a new upload.',
            409,
          );
        if (
          prior.kind !== input.kind ||
          prior.content_type !== input.contentType ||
          prior.expected_sha256 !== input.sha256 ||
          prior.expected_bytes !== input.bytes
        )
          throw new DomainError('DOCUMENT_CONFLICT', 'The file changed. Start a new upload.', 409);
        return this.summary(prior);
      }
      const recent = await client.query(
        "SELECT count(*)::int AS count FROM driver_documents WHERE driver_id=$1 AND created_at > now()-interval '24 hours'",
        [actor.id],
      );
      if (recent.rows[0].count >= 10)
        throw new DomainError(
          'DOCUMENT_LIMIT',
          'Too many document uploads. Try again later or contact support.',
          429,
        );
      const row = (
        await client.query(
          "INSERT INTO driver_documents(id,driver_id,kind,content_type,expected_sha256,expected_bytes,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '15 minutes') RETURNING *",
          [input.id, actor.id, input.kind, input.contentType, input.sha256, input.bytes],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'driver.document_reserved',$2,$3)",
        [actor.id, input.id, JSON.stringify({ kind: input.kind })],
      );
      return this.summary(row);
    });
  }
  private async ownedReservation(actor: Actor, documentId: string) {
    driverOnly(actor);
    const id = z.uuid().parse(documentId);
    const row = (
      await this.pool.query(
        'SELECT x.*,u.disabled,x.expires_at > now() AS valid FROM driver_documents x JOIN users u ON u.id=x.driver_id WHERE x.id=$1 AND x.driver_id=$2',
        [id, actor.id],
      )
    ).rows[0];
    if (!row) throw new DomainError('DOCUMENT_NOT_FOUND', 'This document upload was not found.', 404);
    if (row.disabled) throw new DomainError('FORBIDDEN', 'This account cannot submit documents.', 403);
    return row;
  }
  private transferProvider() {
    if (!this.transfers)
      throw new DomainError(
        'DOCUMENT_UPLOAD_UNAVAILABLE',
        'Document uploads are not available yet. Try again later.',
        503,
      );
    return this.transfers;
  }
  private reservationInput(row: Record<string, unknown>) {
    return Reservation.parse({
      id: row.id,
      kind: row.kind,
      contentType: row.content_type,
      sha256: row.expected_sha256,
      bytes: row.expected_bytes,
    });
  }
  async uploadTarget(actor: Actor, documentId: string) {
    const row = await this.ownedReservation(actor, documentId);
    if (row.state !== 'reserved')
      throw new DomainError('DOCUMENT_CONFLICT', 'This document has already been uploaded.', 409);
    if (!row.valid)
      throw new DomainError('DOCUMENT_EXPIRED', 'This upload expired. Start a new upload.', 409);
    return DriverDocumentUploadTarget.parse(
      await this.transferProvider().forms.issue({
        ...this.reservationInput(row),
        expiresAt: (row.expires_at as Date).toISOString(),
      }),
    );
  }
  async completeUpload(actor: Actor, documentId: string, key: string) {
    const row = await this.ownedReservation(actor, documentId);
    const prefix = `driver-documents/inbox/${documentId}/`;
    if (!key.startsWith(prefix) || !z.uuid().safeParse(key.slice(prefix.length)).success)
      throw new DomainError('INVALID_DOCUMENT', 'The upload reference is invalid.', 422);
    if (row.state === 'quarantined') return this.summary(row);
    if (!row.valid)
      throw new DomainError('DOCUMENT_EXPIRED', 'This upload expired. Start a new upload.', 409);
    const provider = this.transferProvider();
    const bytes = await provider.inbox.read({ ...this.reservationInput(row), key });
    return this.upload(actor, documentId, bytes, provider.quarantine);
  }
  /** Server upload orchestration. Transport must bound the body before calling this method. */
  async upload(actor: Actor, documentId: string, bytes: Uint8Array, store: DocumentQuarantineStore) {
    driverOnly(actor);
    const id = z.uuid().parse(documentId);
    const row = (
      await this.pool.query(
        `SELECT x.*,u.disabled,x.expires_at > now() AS valid
         FROM driver_documents x JOIN users u ON u.id=x.driver_id
         WHERE x.id=$1 AND x.driver_id=$2`,
        [id, actor.id],
      )
    ).rows[0];
    if (!row)
      throw new DomainError('DOCUMENT_NOT_FOUND', 'Start a document upload before submitting a file.', 404);
    if (row.disabled) throw new DomainError('FORBIDDEN', 'This account cannot submit documents.', 403);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== row.expected_bytes)
      throw new DomainError(
        'INVALID_DOCUMENT_SIZE',
        'The file size does not match this upload request.',
        422,
      );
    // Snapshot before asynchronous storage so mutable caller memory cannot change the submitted file.
    const body = Uint8Array.from(bytes);
    if (createHash('sha256').update(body).digest('hex') !== row.expected_sha256)
      throw new DomainError(
        'DOCUMENT_CHECKSUM_MISMATCH',
        'The file changed. Select it again before uploading.',
        422,
      );
    // A lost response can be retried without writing a second object, even after expiry.
    if (row.state === 'quarantined') return this.summary(row);
    if (!row.valid)
      throw new DomainError('DOCUMENT_EXPIRED', 'This upload expired. Start a new upload.', 409);
    const receipt = await quarantineDriverDocument(
      {
        documentId: id,
        driverId: actor.id,
        kind: row.kind,
        contentType: row.content_type,
        expectedSha256: row.expected_sha256,
      },
      body,
      trackedDocumentStore(this.pool, actor, id, store),
    );
    // Recheck account state and expiry transactionally after network I/O.
    return this.recordQuarantine(actor, receipt);
  }
  /** Internal use only: receipt comes from validated quarantine storage, never an HTTP request body. */
  async recordQuarantine(actor: Actor, raw: unknown) {
    driverOnly(actor);
    const receipt = z
      .object({
        documentId: z.uuid(),
        driverId: z.uuid(),
        kind: Reservation.shape.kind,
        contentType: Reservation.shape.contentType,
        sha256: Reservation.shape.sha256,
        bytes: Reservation.shape.bytes,
        state: z.literal('quarantined'),
        key: z.string().max(300),
        version: z.string().min(1).max(1024),
      })
      .strict()
      .parse(raw);
    if (receipt.driverId !== actor.id)
      throw new DomainError('FORBIDDEN', 'This upload does not belong to your account.', 403);
    const prefix = `driver-documents/quarantine/${receipt.documentId}/`;
    if (!receipt.key.startsWith(prefix) || !z.uuid().safeParse(receipt.key.slice(prefix.length)).success)
      throw new DomainError('INVALID_DOCUMENT', 'The stored document could not be verified.', 422);
    return transaction(this.pool, async (client) => {
      const account = (
        await client.query(
          'SELECT d.id,u.disabled FROM drivers d JOIN users u ON u.id=d.id WHERE d.id=$1 FOR UPDATE OF d,u',
          [actor.id],
        )
      ).rows[0];
      if (!account || account.disabled)
        throw new DomainError('FORBIDDEN', 'This account cannot submit documents.', 403);
      const row = (
        await client.query(
          'SELECT *,expires_at > now() AS valid FROM driver_documents WHERE id=$1 AND driver_id=$2 FOR UPDATE',
          [receipt.documentId, actor.id],
        )
      ).rows[0];
      if (!row)
        throw new DomainError('DOCUMENT_NOT_FOUND', 'Start a document upload before submitting a file.', 404);
      if (
        row.kind !== receipt.kind ||
        row.content_type !== receipt.contentType ||
        row.expected_sha256 !== receipt.sha256 ||
        row.expected_bytes !== receipt.bytes
      )
        throw new DomainError(
          'DOCUMENT_CONFLICT',
          'The stored file does not match this upload request.',
          409,
        );
      if (row.state === 'quarantined') {
        if (row.object_key !== receipt.key || row.object_version !== receipt.version)
          throw new DomainError(
            'DOCUMENT_CONFLICT',
            'A different file is already attached to this upload.',
            409,
          );
        return this.summary(row);
      }
      if (!row.valid)
        throw new DomainError('DOCUMENT_EXPIRED', 'This upload expired. Start a new upload.', 409);
      const saved = (
        await client.query(
          "UPDATE driver_documents SET state='quarantined',object_key=$2,object_version=$3 WHERE id=$1 RETURNING *",
          [receipt.documentId, receipt.key, receipt.version],
        )
      ).rows[0];
      await client.query('INSERT INTO driver_document_scans(document_id) VALUES($1)', [receipt.documentId]);
      // Replacement evidence needs a fresh eligibility decision; accepted rides retain their lifecycle.
      await client.query('UPDATE drivers SET approved=false,eligibility_expires_at=NULL WHERE id=$1', [
        actor.id,
      ]);
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'driver.document_quarantined',$2,$3)",
        [actor.id, receipt.documentId, JSON.stringify({ kind: receipt.kind })],
      );
      return this.summary(saved);
    });
  }
  async list(actor: Actor) {
    driverOnly(actor);
    const result = await this.pool.query(
      `SELECT x.*,r.decision AS review_decision,r.expires_at AS review_expires_at,
        r.reason AS review_reason,r.reviewed_at,r.object_key AS review_object_key,
        r.object_version AS review_object_version,r.sha256 AS review_sha256,
        CASE
          WHEN s.state IN ('clean','infected') AND s.scanned_key=x.object_key
            AND s.scanned_version=x.object_version AND s.scanned_sha256=x.expected_sha256
            THEN CASE WHEN s.state='clean' THEN 'awaiting_review' ELSE 'replacement_required' END
          WHEN s.state='failed' THEN 'delayed'
          ELSE 'pending'
        END AS verification
       FROM driver_documents x JOIN users u ON u.id=x.driver_id
       LEFT JOIN driver_document_scans s ON s.document_id=x.id
       LEFT JOIN driver_document_reviews r ON r.document_id=x.id
       WHERE x.driver_id=$1 AND NOT u.disabled ORDER BY x.created_at DESC,x.id DESC LIMIT 30`,
      [actor.id],
    );
    return { documents: result.rows.map((row) => this.summary(row)) };
  }
  private summary(row: Record<string, unknown>) {
    const expiresAt = row.expires_at as Date;
    const reviewedExpiry = row.review_expires_at as Date | null;
    const review =
      row.verification === 'awaiting_review' &&
      row.review_decision &&
      row.review_object_key === row.object_key &&
      row.review_object_version === row.object_version &&
      row.review_sha256 === row.expected_sha256
        ? {
            status:
              row.review_decision === 'approved' && reviewedExpiry && reviewedExpiry.getTime() <= Date.now()
                ? 'expired'
                : row.review_decision,
            reason: row.review_reason,
            expiresAt: reviewedExpiry?.toISOString() ?? null,
            reviewedAt: (row.reviewed_at as Date).toISOString(),
          }
        : undefined;
    return Summary.parse({
      id: row.id,
      kind: row.kind,
      state: row.state === 'reserved' && expiresAt.getTime() <= Date.now() ? 'expired' : row.state,
      ...(row.state === 'quarantined' && row.verification ? { verification: row.verification } : {}),
      ...(review ? { review } : {}),
      createdAt: (row.created_at as Date).toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  }
}
