import { S3DocumentConfig as Config } from './s3-document-config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { S3Client, GetBucketVersioningCommand, GetPublicAccessBlockCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { DriverDocumentReservation } from '@rove/contracts';
import { DomainError } from './errors';

const Upload = DriverDocumentReservation.extend({ expiresAt: z.iso.datetime() });

/** Issue only from server-owned, authorized reservation metadata. Never log returned bearer fields. */
export class S3DocumentUploadForms {
  private config: z.infer<typeof Config>;
  private client: S3Client;
  constructor(config: z.infer<typeof Config>, client?: S3Client) {
    this.config = Config.parse(config);
    this.client =
      client ?? new S3Client({ region: config.region, maxAttempts: 2, ignoreConfiguredEndpointUrls: true });
  }
  async issue(raw: unknown) {
    const input = Upload.parse(raw);
    if (Date.parse(input.expiresAt) <= Date.now())
      throw new DomainError('DOCUMENT_EXPIRED', 'This upload expired. Start a new upload.', 409);
    try {
      const target = { Bucket: this.config.bucket, ExpectedBucketOwner: this.config.ownerAccountId };
      const abortSignal = AbortSignal.timeout(10_000);
      const [versioning, access] = await Promise.all([
        this.client.send(new GetBucketVersioningCommand(target), { abortSignal }),
        this.client.send(new GetPublicAccessBlockCommand(target), { abortSignal }),
      ]);
      const block = access.PublicAccessBlockConfiguration;
      if (
        versioning.Status !== 'Enabled' ||
        !block?.BlockPublicAcls ||
        !block.BlockPublicPolicy ||
        !block.IgnorePublicAcls ||
        !block.RestrictPublicBuckets
      )
        throw new Error('Private versioned storage required');
      const seconds = Math.min(120, Math.floor((Date.parse(input.expiresAt) - Date.now()) / 1000));
      if (seconds < 1) throw new Error('Reservation expired while preparing upload');
      // Inbox bytes are untrusted. They must be read, validated and copied to immutable quarantine.
      const key = `driver-documents/inbox/${input.id}/${randomUUID()}`;
      const fields = {
        'Content-Type': input.contentType,
        'Content-Disposition': 'attachment',
        'Cache-Control': 'no-store',
        'x-amz-server-side-encryption': 'AES256',
        'x-amz-checksum-algorithm': 'SHA256',
        'x-amz-checksum-sha256': Buffer.from(input.sha256, 'hex').toString('base64'),
        success_action_status: '201',
      };
      const post = await createPresignedPost(this.client, {
        Bucket: this.config.bucket,
        Key: key,
        Expires: seconds,
        Fields: fields,
        Conditions: [
          ['content-length-range', input.bytes, input.bytes],
          ...Object.entries(fields).map(([name, value]) => ({ [name]: value })),
        ],
      });
      // Prevent custom endpoint configuration from sending private files to another host.
      const expectedHost = `${this.config.bucket}.s3.${this.config.region}.amazonaws.com`;
      const url = new URL(post.url);
      if (url.protocol !== 'https:' || url.host !== expectedHost || url.username || url.password)
        throw new Error('Unexpected storage endpoint');
      return {
        documentId: input.id,
        key,
        url: post.url,
        fields: post.fields,
        expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
      };
    } catch {
      throw new DomainError(
        'DOCUMENT_STORAGE_UNAVAILABLE',
        'The upload could not be prepared. Try again.',
        503,
      );
    }
  }
}
