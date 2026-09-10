import { createHash } from 'node:crypto';
import { z } from 'zod';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DriverDocumentReservation } from '@rove/contracts';
import { DomainError } from './errors';
const Config = z
  .object({
    bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
    region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
    ownerAccountId: z.string().regex(/^\d{12}$/),
  })
  .strict();
const Request = DriverDocumentReservation.extend({ key: z.string().max(300) });
/** Server-only inbox reader. Authorize the reservation before calling; never accept a client URL. */
export class S3DocumentInbox {
  private config: z.infer<typeof Config>;
  private client: S3Client;
  constructor(config: z.infer<typeof Config>, client?: S3Client) {
    this.config = Config.parse(config);
    this.client =
      client ?? new S3Client({ region: config.region, maxAttempts: 2, ignoreConfiguredEndpointUrls: true });
  }
  async read(raw: unknown): Promise<Uint8Array> {
    const input = Request.parse(raw);
    const prefix = `driver-documents/inbox/${input.id}/`;
    if (!input.key.startsWith(prefix) || !z.uuid().safeParse(input.key.slice(prefix.length)).success)
      throw new DomainError('INVALID_DOCUMENT', 'The upload reference is invalid.', 422);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          ExpectedBucketOwner: this.config.ownerAccountId,
          Key: input.key,
          ChecksumMode: 'ENABLED',
        }),
        { abortSignal: controller.signal },
      );
      if (
        !result.VersionId ||
        result.VersionId === 'null' ||
        result.ServerSideEncryption !== 'AES256' ||
        result.ContentLength !== input.bytes ||
        result.ContentType !== input.contentType ||
        result.ChecksumSHA256 !== Buffer.from(input.sha256, 'hex').toString('base64')
      )
        throw new Error('Unverified uploaded object');
      if (!result.Body || !(Symbol.asyncIterator in result.Body)) throw new Error('Missing upload stream');
      const output = new Uint8Array(input.bytes);
      let offset = 0;
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        if (
          controller.signal.aborted ||
          !(chunk instanceof Uint8Array) ||
          offset + chunk.length > output.length
        )
          throw new Error('Upload exceeded its declared size or deadline');
        output.set(chunk, offset);
        offset += chunk.length;
      }
      if (
        controller.signal.aborted ||
        offset !== output.length ||
        createHash('sha256').update(output).digest('hex') !== input.sha256
      )
        throw new Error('Uploaded bytes do not match reservation');
      return output;
    } catch {
      throw new DomainError(
        'DOCUMENT_UPLOAD_UNVERIFIED',
        'The uploaded file could not be verified. Retry or select the file again.',
        422,
      );
    } finally {
      // Close a rejected/unfinished network stream as well as the deadline timer.
      controller.abort();
      clearTimeout(timeout);
    }
  }
}
