import { z } from 'zod';
import {
  S3Client,
  GetBucketVersioningCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type S3ClientConfig,
  type HeadObjectCommandInput,
  type HeadObjectCommandOutput,
  type DeleteObjectCommandInput,
  type DeleteObjectCommandOutput,
  type GetBucketVersioningCommandOutput,
} from '@aws-sdk/client-s3';
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
  head(input: HeadObjectCommandInput, signal: AbortSignal): Promise<HeadObjectCommandOutput>;
  remove(input: DeleteObjectCommandInput, signal: AbortSignal): Promise<DeleteObjectCommandOutput>;
}
const Missing = z.object({
  name: z.enum(['NotFound', 'NoSuchVersion', 'NoSuchKey']),
  $metadata: z.object({ httpStatusCode: z.literal(404) }),
  DeleteMarker: z.literal(false).optional(),
});
/** Provider boundary only. Caller must durably authorize this exact version and check retention holds before dispatch. */
export class S3DocumentErasure {
  private config: z.infer<typeof S3DocumentConfig>;
  private operations: S3DocumentErasureOperations;
  private client: S3Client | null;
  constructor(
    config: z.infer<typeof S3DocumentConfig>,
    operations?: S3DocumentErasureOperations,
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
      versioning: (signal) =>
        this.client!.send(
          new GetBucketVersioningCommand({
            Bucket: this.config.bucket,
            ExpectedBucketOwner: this.config.ownerAccountId,
          }),
          { abortSignal: signal },
        ),
      head: (input, signal) => this.client!.send(new HeadObjectCommand(input), { abortSignal: signal }),
      remove: (input, signal) => this.client!.send(new DeleteObjectCommand(input), { abortSignal: signal }),
    };
  }
  close() {
    this.client?.destroy();
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
      let result: HeadObjectCommandOutput;
      try {
        result = await this.operations.head(target, signal);
      } catch (error) {
        if (Missing.safeParse(error).success) return false;
        throw error;
      }
      if (
        result.$metadata.httpStatusCode !== 200 ||
        result.VersionId !== input.version ||
        result.DeleteMarker
      )
        throw new Error('Unverified document version');
      return true;
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
