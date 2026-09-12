import { z } from 'zod';
import {
  S3Client,
  ListObjectVersionsCommand,
  type S3ClientConfig,
  type ListObjectVersionsCommandInput,
  type ListObjectVersionsCommandOutput,
} from '@aws-sdk/client-s3';
import { S3DocumentConfig } from './s3-document-config';
import { DomainError } from './errors';
export interface DocumentObjectVersion {
  documentId: string;
  key: string;
  version: string;
  kind: 'object' | 'delete_marker';
}
export interface S3DocumentInventoryOperations {
  list(input: ListObjectVersionsCommandInput, signal: AbortSignal): Promise<ListObjectVersionsCommandOutput>;
}
const Entry = z.object({
  Key: z.string().max(300),
  VersionId: z
    .string()
    .min(1)
    .max(1024)
    .refine((v) => v !== 'null'),
});
/** Read-only discovery, not an atomic storage snapshot or erasure authorization. */
export class S3DocumentInventory {
  private config: z.infer<typeof S3DocumentConfig>;
  private operations: S3DocumentInventoryOperations;
  private client: S3Client | null;
  constructor(
    config: z.infer<typeof S3DocumentConfig>,
    operations?: S3DocumentInventoryOperations,
    credentials?: S3ClientConfig['credentials'],
  ) {
    this.config = S3DocumentConfig.parse(config);
    this.client = operations
      ? null
      : new S3Client({
          region: this.config.region,
          maxAttempts: 2,
          ignoreConfiguredEndpointUrls: true,
          ...(credentials ? { credentials } : {}),
        });
    this.operations = operations ?? {
      list: (input, signal) =>
        this.client!.send(new ListObjectVersionsCommand(input), { abortSignal: signal }),
    };
  }
  close() {
    this.client?.destroy();
  }
  async discover(rawId: string): Promise<DocumentObjectVersion[]> {
    const parsed = z.uuid().safeParse(rawId);
    if (!parsed.success)
      throw new DomainError('INVALID_DOCUMENT', 'Invalid document inventory reference.', 422);
    const documentId = parsed.data;
    const signal = AbortSignal.timeout(15_000);
    const versions: DocumentObjectVersion[] = [];
    const seen = new Set<string>();
    try {
      for (const zone of ['inbox', 'quarantine']) {
        const prefix = `driver-documents/${zone}/${documentId}/`;
        let keyMarker: string | undefined, versionMarker: string | undefined;
        const cursors = new Set<string>();
        // The installed S3 SDK has no ListObjectVersions paginator. Both markers
        // are required so multiple versions of one key are not skipped.
        for (let pageNumber = 0; ; pageNumber++) {
          if (pageNumber >= 100 || signal.aborted) throw new Error('Inventory limit');
          const page = await this.operations.list(
            {
              Bucket: this.config.bucket,
              ExpectedBucketOwner: this.config.ownerAccountId,
              Prefix: prefix,
              MaxKeys: 1000,
              ...(keyMarker ? { KeyMarker: keyMarker, VersionIdMarker: versionMarker } : {}),
            },
            signal,
          );
          if (
            page.$metadata.httpStatusCode !== 200 ||
            page.Name !== this.config.bucket ||
            page.Prefix !== prefix ||
            typeof page.IsTruncated !== 'boolean' ||
            page.EncodingType ||
            page.Delimiter ||
            page.CommonPrefixes?.length
          )
            throw new Error('Unverified inventory page');
          for (const [kind, rows] of [
            ['object', page.Versions ?? []],
            ['delete_marker', page.DeleteMarkers ?? []],
          ] as const) {
            for (const raw of rows) {
              const row = Entry.parse(raw);
              if (!row.Key.startsWith(prefix) || !z.uuid().safeParse(row.Key.slice(prefix.length)).success)
                throw new Error('Inventory scope mismatch');
              const identity = JSON.stringify([row.Key, row.VersionId]);
              if (seen.has(identity) || versions.length >= 10_000)
                throw new Error('Ambiguous or excessive inventory');
              seen.add(identity);
              versions.push({ documentId, key: row.Key, version: row.VersionId, kind });
            }
          }
          if (!page.IsTruncated) break;
          if (
            !page.NextKeyMarker?.startsWith(prefix) ||
            !z.uuid().safeParse(page.NextKeyMarker.slice(prefix.length)).success ||
            !Entry.shape.VersionId.safeParse(page.NextVersionIdMarker).success
          )
            throw new Error('Incomplete inventory cursor');
          const cursor = JSON.stringify([page.NextKeyMarker, page.NextVersionIdMarker]);
          if (cursors.has(cursor)) throw new Error('Repeated inventory cursor');
          cursors.add(cursor);
          keyMarker = page.NextKeyMarker;
          versionMarker = page.NextVersionIdMarker;
        }
      }
      return versions;
    } catch {
      throw new DomainError(
        'DOCUMENT_INVENTORY_UNAVAILABLE',
        'Document version inventory is not verified.',
        503,
      );
    }
  }
}
