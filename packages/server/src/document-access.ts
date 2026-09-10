import type { Pool } from 'pg';
import { z } from 'zod';
import type { Actor } from './rides';
import { requireStaffPermission } from './staff-access';
import { transaction } from './transactions';
import { DomainError } from './errors';

export interface DocumentDownloads {
  issue(target: {
    documentId: string;
    key: string;
    version: string;
    contentType: string;
  }): Promise<{ url: string; expiresAt: string }>;
  close?(): void;
}
/** Authorizes each link issuance; possession of a prior document id grants no access. */
export class DocumentAccessService {
  constructor(
    private pool: Pool,
    private downloads?: DocumentDownloads,
  ) {}
  async download(actor: Actor, rawId: string) {
    const documentId = z.uuid().parse(rawId);
    return transaction(this.pool, async (client) => {
      await requireStaffPermission(client, actor, 'driver.document.review');
      const row = (
        await client.query(
          `SELECT d.* FROM driver_documents d JOIN users u ON u.id=d.driver_id
         JOIN driver_document_scans s ON s.document_id=d.id
         WHERE d.id=$1 AND NOT u.disabled AND d.state='quarantined' AND s.state='clean'
           AND s.scanned_key=d.object_key AND s.scanned_version=d.object_version AND s.scanned_sha256=d.expected_sha256
         FOR SHARE OF d,u,s`,
          [documentId],
        )
      ).rows[0];
      if (!row)
        throw new DomainError('DOCUMENT_NOT_REVIEWABLE', 'This file is not available for review.', 409);
      if (!this.downloads)
        throw new DomainError('DOCUMENT_STORAGE_UNAVAILABLE', 'Document viewing is not available yet.', 503);
      let link: { url: string; expiresAt: string };
      try {
        link = await this.downloads.issue({
          documentId,
          key: row.object_key,
          version: row.object_version,
          contentType: row.content_type,
        });
      } catch {
        throw new DomainError(
          'DOCUMENT_STORAGE_UNAVAILABLE',
          'Document viewing is temporarily unavailable.',
          503,
        );
      }
      await client.query(
        "INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'staff.document_access_issued',$2,'{}')",
        [actor.id, documentId],
      );
      return link;
    });
  }
}
