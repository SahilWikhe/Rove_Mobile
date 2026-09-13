import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
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
  close?(): void;
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

  async nextWakeAfterSeconds(): Promise<number | null> {
    const row = (
      await scanTransaction(this.pool, 'queue', (client) =>
        client.query<{ due: Date | null }>(
          `SELECT min(GREATEST(s.available_at,COALESCE(s.locked_until,s.available_at))) AS due
       FROM driver_document_scans s JOIN driver_documents d ON d.id=s.document_id
       WHERE s.state='pending' AND d.state='quarantined'`,
        ),
      )
    ).rows[0];
    return row?.due
      ? Math.max(1, Math.min(3600, Math.ceil((row.due.getTime() - this.now().getTime()) / 1000)))
      : null;
  }

  async runOnce(): Promise<'idle' | 'clean' | 'infected' | 'retry' | 'failed' | 'stale'> {
    const token = randomUUID();
    const row = (
      await scanTransaction(this.pool, 'queue', (client) =>
        client.query<Claimed>(
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
        ),
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
      return await scanTransaction(this.pool, target.documentId, async (client) => {
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
      const saved = await scanTransaction(this.pool, target.documentId, (client) =>
        client.query(
          `UPDATE driver_document_scans SET state=$3,available_at=$4,lease_token=NULL,locked_until=NULL
         WHERE document_id=$1 AND lease_token=$2 AND state='pending' AND locked_until>$5`,
          [target.documentId, token, terminal ? 'failed' : 'pending', retryAt, this.now()],
        ),
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
  const result = await scanTransaction(pool, documentId, (client) =>
    client.query(
      `SELECT 1 FROM driver_document_scans s JOIN driver_documents d ON d.id=s.document_id
     WHERE d.id=$1 AND d.state='quarantined' AND s.state='clean'
       AND s.scanned_key=d.object_key AND s.scanned_version=d.object_version
       AND s.scanned_sha256=d.expected_sha256`,
      [documentId],
    ),
  );
  return result.rowCount === 1;
}

/** Trusted scanner context, scoped locally to queue discovery or one result target. */
async function scanTransaction<T>(
  pool: Pool,
  scope: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (scope !== 'queue') z.uuid().parse(scope);
  return transaction(pool, async (client) => {
    await client.query(
      "SELECT set_config('rove.actor_id','',true),set_config('rove.actor_role','',true),set_config('rove.actor_mfa','false',true),set_config('rove.loss_source','',true),set_config('rove.loss_attempt','',true),set_config('rove.loss_journal','',true),set_config('rove.refund_operation_source','',true),set_config('rove.refund_operation_attempt','',true),set_config('rove.refund_operation_read','',true),set_config('rove.refund_operation_write','',true),set_config('rove.refund_closure_owner','',true),set_config('rove.dispute_source','',true),set_config('rove.dispute_read','',true),set_config('rove.dispute_write','',true),set_config('rove.dispute_sweep','false',true),set_config('rove.refund_source','',true),set_config('rove.refund_read','',true),set_config('rove.refund_write','',true),set_config('rove.refund_sweep','false',true),set_config('rove.customer_source','',true),set_config('rove.customer_read','',true),set_config('rove.customer_write','',true),set_config('rove.customer_result','',true),set_config('rove.capture_source','',true),set_config('rove.capture_write','',true),set_config('rove.capture_read','',true),set_config('rove.capture_sweep','false',true),set_config('rove.capture_balance','',true),set_config('rove.install_project','',true),set_config('rove.install_lookup','',true),set_config('rove.install_token','',true),set_config('rove.install_target','',true),set_config('rove.install_revision','',true),set_config('rove.audience_rider','',true),set_config('rove.audience_rider_project','',true),set_config('rove.audience_driver','',true),set_config('rove.audience_driver_project','',true),set_config('rove.push_event','',true),set_config('rove.push_installation','',true),set_config('rove.push_revision','',true),set_config('rove.push_delivery','',true),set_config('rove.push_recovery_at','',true),set_config('rove.push_rate_project','',true),set_config('rove.rate_key','',true),set_config('rove.rate_prune','false',true),set_config('rove.write_document','',true),set_config('rove.write_key','',true),set_config('rove.identity_request','',true),set_config('rove.notification_message','',true),set_config('rove.notification_offer','',true),set_config('rove.closure_guard_owner','',true),set_config('rove.retention_owner','',true),set_config('rove.cleanup_item','',true),set_config('rove.scan_queue',$1,true),set_config('rove.scan_document',$2,true)",
      [scope === 'queue' ? 'true' : 'false', scope === 'queue' ? '' : scope],
    );
    return work(client);
  });
}
