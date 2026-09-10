import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { transaction } from './transactions';

export interface ScanTarget {
  documentId: string;
  key: string;
  version: string;
  sha256: string;
}
/** Trusted server adapter only. Scan the exact immutable version; unsupported files must fail closed. */
export interface DocumentScanner {
  scan(target: ScanTarget, signal: AbortSignal): Promise<ScanTarget & { verdict: 'clean' | 'infected' }>;
}
const Result = z
  .object({
    documentId: z.uuid(),
    key: z.string().min(1),
    version: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    verdict: z.enum(['clean', 'infected']),
  })
  .strict();

interface Claimed {
  document_id: string;
  object_key: string;
  object_version: string;
  expected_sha256: string;
  attempts: number;
}

/** A separate durable queue keeps unavailable scanning from consuming ride/payment worker capacity. */
export class DocumentScanWorker {
  constructor(
    private pool: Pool,
    private scanner: DocumentScanner,
    private now: () => Date = () => new Date(),
  ) {}

  async runOnce(): Promise<'idle' | 'clean' | 'infected' | 'retry' | 'failed' | 'stale'> {
    const token = randomUUID();
    const row = (
      await this.pool.query<Claimed>(
        `WITH claimed AS (
        UPDATE driver_document_scans SET lease_token=$1,
          locked_until=$2::timestamptz+interval '60 seconds',attempts=attempts+1
        WHERE document_id=(
          SELECT s.document_id FROM driver_document_scans s
          JOIN driver_documents d ON d.id=s.document_id
          WHERE s.state='pending' AND d.state='quarantined' AND s.available_at<=$2
            AND (s.locked_until IS NULL OR s.locked_until<=$2)
          ORDER BY s.available_at,s.document_id FOR UPDATE OF s SKIP LOCKED LIMIT 1
        ) RETURNING *
      )
      SELECT c.*,d.object_key,d.object_version,d.expected_sha256 FROM claimed c
      JOIN driver_documents d ON d.id=c.document_id`,
        [token, this.now()],
      )
    ).rows[0];
    if (!row) return 'idle';
    const target: ScanTarget = {
      documentId: row.document_id,
      key: row.object_key,
      version: row.object_version,
      sha256: row.expected_sha256,
    };
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error('Scan timeout'));
        }, 25_000);
      });
      const result = Result.parse(
        await Promise.race([this.scanner.scan({ ...target }, abort.signal), timeout]),
      );
      if (
        result.documentId !== target.documentId ||
        result.key !== target.key ||
        result.version !== target.version ||
        result.sha256 !== target.sha256
      )
        throw new Error('Scanner result does not match the quarantined version');
      // Fence expired workers and bind evidence to the current document even if it changed during I/O.
      return await transaction(this.pool, async (client) => {
        const saved = await client.query(
          `UPDATE driver_document_scans s SET state=$3,scanned_key=$4,scanned_version=$5,
            scanned_sha256=$6,completed_at=$7,lease_token=NULL,locked_until=NULL
          FROM driver_documents d WHERE s.document_id=$1 AND s.lease_token=$2
            AND s.locked_until>$7 AND s.state='pending' AND d.id=s.document_id
            AND d.state='quarantined' AND d.object_key=$4 AND d.object_version=$5 AND d.expected_sha256=$6`,
          [target.documentId, token, result.verdict, target.key, target.version, target.sha256, this.now()],
        );
        if (!saved.rowCount) return 'stale';
        await client.query(
          "INSERT INTO audit(action,aggregate_id,metadata) VALUES('driver.document_scanned',$1,$2)",
          [target.documentId, JSON.stringify({ verdict: result.verdict })],
        );
        // Clean is malware evidence only; never grant driver eligibility here.
        return result.verdict;
      });
    } catch {
      // Provider errors can contain private keys/URLs. Persist no raw error or document content.
      const terminal = row.attempts >= 12;
      const retryAt = new Date(
        this.now().getTime() + Math.min(300_000, 1000 * 2 ** Math.min(row.attempts, 8)),
      );
      const saved = await this.pool.query(
        `UPDATE driver_document_scans SET state=$3,available_at=$4,lease_token=NULL,locked_until=NULL
         WHERE document_id=$1 AND lease_token=$2 AND state='pending' AND locked_until>$5`,
        [target.documentId, token, terminal ? 'failed' : 'pending', retryAt, this.now()],
      );
      return saved.rowCount ? (terminal ? 'failed' : 'retry') : 'stale';
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }
}

/** Internal guard for future staff access: a clean verdict for another version never authorizes access. */
export async function hasCleanDocumentScan(pool: Pool, documentId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM driver_document_scans s JOIN driver_documents d ON d.id=s.document_id
     WHERE d.id=$1 AND d.state='quarantined' AND s.state='clean'
       AND s.scanned_key=d.object_key AND s.scanned_version=d.object_version
       AND s.scanned_sha256=d.expected_sha256`,
    [documentId],
  );
  return result.rowCount === 1;
}
