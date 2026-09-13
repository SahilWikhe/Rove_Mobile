import { z } from 'zod';
import {
  S3Client,
  GetBucketVersioningCommand,
  DeleteObjectCommand,
  type S3ClientConfig,
  type DeleteObjectCommandInput,
  type DeleteObjectCommandOutput,
  type GetBucketVersioningCommandOutput,
} from '@aws-sdk/client-s3';
import { S3DocumentInventory } from './s3-document-inventory';
import { S3DocumentConfig } from './s3-document-config';
import { DomainError } from './errors';

const Target = z
  .object({
    documentId: z.uuid(),
    key: z.string().max(300),
    version: z
      .string()
      .min(1)
      .max(1024)
      .refine((v) => v !== 'null'),
  })
  .strict();
export type DocumentErasureTarget = z.infer<typeof Target>;
export interface S3DocumentErasureOperations {
  versioning(signal: AbortSignal): Promise<GetBucketVersioningCommandOutput>;
  remove(input: DeleteObjectCommandInput, signal: AbortSignal): Promise<DeleteObjectCommandOutput>;
}
/** Provider boundary only. Caller must durably authorize this exact version and check retention holds before dispatch. */
export class S3DocumentErasure {
  private config: z.infer<typeof S3DocumentConfig>;
  private operations: S3DocumentErasureOperations;
  private client: S3Client | null;
  private inventory: Pick<S3DocumentInventory, 'discover'>;
  private ownedInventory: S3DocumentInventory | undefined;
  constructor(
    config: z.infer<typeof S3DocumentConfig>,
    operations?: S3DocumentErasureOperations,
    credentials?: S3ClientConfig['credentials'],
    inventory?: Pick<S3DocumentInventory, 'discover'>,
  ) {
    this.config = S3DocumentConfig.parse(config);
    this.ownedInventory = inventory
      ? undefined
      : new S3DocumentInventory(this.config, undefined, credentials);
    this.inventory = inventory ?? this.ownedInventory!;
    this.client = operations
      ? null
      : new S3Client({
          region: this.config.region,
          maxAttempts: 2,
          ignoreConfiguredEndpointUrls: true,
          ...(credentials ? { credentials } : {}),
        });
    this.operations = operations ?? {
      versioning: (signal) =>
        this.client!.send(
          new GetBucketVersioningCommand({
            Bucket: this.config.bucket,
            ExpectedBucketOwner: this.config.ownerAccountId,
          }),
          { abortSignal: signal },
        ),
      remove: (input, signal) => this.client!.send(new DeleteObjectCommand(input), { abortSignal: signal }),
    };
  }
  close() {
    this.client?.destroy();
    this.ownedInventory?.close();
  }
  async erase(raw: DocumentErasureTarget): Promise<{ status: 'absent' }> {
    const parsed = Target.safeParse(raw);
    if (!parsed.success)
      throw new DomainError('INVALID_DOCUMENT', 'Invalid document erasure reference.', 422);
    const input = parsed.data;
    const parts = input.key.split('/');
    if (
      parts.length !== 4 ||
      parts[0] !== 'driver-documents' ||
      !['quarantine', 'inbox'].includes(parts[1]!) ||
      parts[2] !== input.documentId ||
      !z.uuid().safeParse(parts[3]).success
    )
      throw new DomainError('INVALID_DOCUMENT', 'Invalid document erasure reference.', 422);
    const target = {
      Bucket: this.config.bucket,
      ExpectedBucketOwner: this.config.ownerAccountId,
      Key: input.key,
      VersionId: input.version,
    };
    const signal = AbortSignal.timeout(15_000);
    const exists = async () => {
      // A complete validated version listing proves absence without document-read permission.
      const entries = await this.inventory.discover(input.documentId);
      signal.throwIfAborted();
      const entry = entries.find((row) => row.key === input.key && row.version === input.version);
      if (entry && (entry.documentId !== input.documentId || entry.kind !== 'object'))
        throw new Error('Unverified document version');
      return !!entry;
    };
    try {
      const bucket = await this.operations.versioning(signal);
      if (bucket.Status !== 'Enabled') throw new Error('Versioning required');
      if (!(await exists())) return { status: 'absent' };
      // Never omit VersionId or bypass Object Lock/governance retention.
      const removed = await this.operations.remove(target, signal);
      if (
        removed.$metadata.httpStatusCode !== 204 ||
        removed.VersionId !== input.version ||
        removed.DeleteMarker
      )
        throw new Error('Unverified deletion receipt');
      if (await exists()) throw new Error('Document version remains');
      return { status: 'absent' };
    } catch {
      throw new DomainError('DOCUMENT_ERASURE_UNAVAILABLE', 'Document version removal is not verified.', 503);
    }
  }
}
