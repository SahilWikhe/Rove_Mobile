import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { S3DocumentConfig } from './s3-document-config';
import type { DocumentDownloads } from './document-access';
const Target = z
  .object({
    documentId: z.uuid(),
    key: z.string().max(300),
    version: z
      .string()
      .min(1)
      .max(1024)
      .refine((value) => value !== 'null'),
    contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  })
  .strict();
/** Private version-bound downloads; callers must authorize and verify clean scan evidence. */
export class S3DocumentDownloads implements DocumentDownloads {
  private config: z.infer<typeof S3DocumentConfig>;
  private client: S3Client;
  constructor(
    config: z.infer<typeof S3DocumentConfig>,
    client?: S3Client,
    private now = () => new Date(),
    credentials?: S3ClientConfig['credentials'],
  ) {
    this.config = S3DocumentConfig.parse(config);
    this.client =
      client ??
      new S3Client({
        ...(credentials ? { credentials } : {}),
        region: config.region,
        maxAttempts: 2,
        ignoreConfiguredEndpointUrls: true,
      });
  }
  close() {
    this.client.destroy();
  }
  async issue(raw: Parameters<DocumentDownloads['issue']>[0]) {
    const input = Target.parse(raw);
    const prefix = `driver-documents/quarantine/${input.documentId}/`;
    if (!input.key.startsWith(prefix) || !z.uuid().safeParse(input.key.slice(prefix.length)).success)
      throw new Error('Invalid quarantine reference');
    const now = this.now();
    const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[
      input.contentType
    ];
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        ExpectedBucketOwner: this.config.ownerAccountId,
        Key: input.key,
        VersionId: input.version,
        ResponseContentType: input.contentType,
        ResponseContentDisposition: `attachment; filename="rove-document.${extension}"`,
        ResponseCacheControl: 'private, no-store, max-age=0',
      }),
      { expiresIn: 60, signingDate: now },
    );
    return { url, expiresAt: new Date(now.getTime() + 60_000).toISOString() };
  }
}
