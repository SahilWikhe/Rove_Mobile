import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  S3Client,
  PutObjectCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  type PutObjectCommandInput,
  type PutObjectCommandOutput,
  type GetBucketVersioningCommandOutput,
  type GetPublicAccessBlockCommandOutput,
} from '@aws-sdk/client-s3';
import { DomainError } from './errors';
import {
  MAX_DRIVER_DOCUMENT_BYTES,
  DriverDocumentMime,
  type DocumentQuarantineStore,
} from './document-intake';

const Config = z
  .object({
    bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
    region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
    ownerAccountId: z.string().regex(/^\d{12}$/),
  })
  .strict();
export interface S3DocumentOperations {
  versioning(signal: AbortSignal): Promise<GetBucketVersioningCommandOutput>;
  publicAccess(signal: AbortSignal): Promise<GetPublicAccessBlockCommandOutput>;
  put(input: PutObjectCommandInput, signal: AbortSignal): Promise<PutObjectCommandOutput>;
}
/** Uses server-side AWS credentials. No storage credential or URL is returned to the mobile client. */
export class S3DocumentStore implements DocumentQuarantineStore {
  private config: z.infer<typeof Config>;
  private operations: S3DocumentOperations;
  constructor(config: z.infer<typeof Config>, operations?: S3DocumentOperations) {
    this.config = Config.parse(config);
    const client = operations
      ? null
      : new S3Client({ region: config.region, maxAttempts: 2, ignoreConfiguredEndpointUrls: true });
    const target = { Bucket: config.bucket, ExpectedBucketOwner: config.ownerAccountId };
    this.operations = operations ?? {
      versioning: (signal) => client!.send(new GetBucketVersioningCommand(target), { abortSignal: signal }),
      publicAccess: (signal) =>
        client!.send(new GetPublicAccessBlockCommand(target), { abortSignal: signal }),
      put: (input, signal) => client!.send(new PutObjectCommand(input), { abortSignal: signal }),
    };
  }
  async put(input: Parameters<DocumentQuarantineStore['put']>[0]) {
    const key = input.key.split('/');
    if (
      key.length !== 4 ||
      key[0] !== 'driver-documents' ||
      key[1] !== 'quarantine' ||
      !z.uuid().safeParse(key[2]).success ||
      !z.uuid().safeParse(key[3]).success ||
      input.ifAbsent !== true ||
      !DriverDocumentMime.safeParse(input.contentType).success ||
      !(input.body instanceof Uint8Array) ||
      !input.body.length ||
      input.body.length > MAX_DRIVER_DOCUMENT_BYTES
    )
      throw new DomainError('INVALID_DOCUMENT', 'Invalid private document upload.', 422);
    const body = Uint8Array.from(input.body);
    const hash = createHash('sha256').update(body).digest();
    if (hash.toString('hex') !== input.sha256)
      throw new DomainError('DOCUMENT_CHECKSUM_MISMATCH', 'The document checksum did not match.', 422);
    const signal = AbortSignal.timeout(15_000);
    try {
      const [versioning, access] = await Promise.all([
        this.operations.versioning(signal),
        this.operations.publicAccess(signal),
      ]);
      if (versioning.Status !== 'Enabled') throw new Error('Versioning required');
      const block = access.PublicAccessBlockConfiguration;
      if (
        !block ||
        !block.BlockPublicAcls ||
        !block.BlockPublicPolicy ||
        !block.IgnorePublicAcls ||
        !block.RestrictPublicBuckets
      )
        throw new Error('Private bucket required');
      const result = await this.operations.put(
        {
          Bucket: this.config.bucket,
          ExpectedBucketOwner: this.config.ownerAccountId,
          Key: input.key,
          Body: body,
          ContentLength: body.length,
          ContentType: input.contentType,
          ContentDisposition: 'attachment',
          CacheControl: 'no-store',
          IfNoneMatch: '*',
          ServerSideEncryption: 'AES256',
          ChecksumSHA256: hash.toString('base64'),
        },
        signal,
      );
      if (
        !result.VersionId ||
        result.VersionId === 'null' ||
        result.ChecksumSHA256 !== hash.toString('base64') ||
        result.ServerSideEncryption !== 'AES256'
      )
        throw new Error('Unverified storage receipt');
      return { version: result.VersionId, sha256: input.sha256, bytes: body.length };
    } catch {
      throw new DomainError(
        'DOCUMENT_STORAGE_UNAVAILABLE',
        'Private document storage could not be verified. Check upload status before retrying.',
        503,
      );
    }
  }
}
