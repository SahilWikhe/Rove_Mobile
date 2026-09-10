import { S3DocumentConfig as Config } from './s3-document-config';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DriverDocumentReservation } from '@rove/contracts';
import { DomainError } from './errors';

function unverified() {
  return new DomainError(
    'DOCUMENT_UPLOAD_UNVERIFIED',
    'The uploaded file could not be verified. Select the file again.',
    422,
  );
}
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
    let discard: (() => void) | undefined;
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
      if (result.Body && 'destroy' in result.Body)
        discard = () => result.Body && 'destroy' in result.Body && result.Body.destroy();
      if (
        !result.VersionId ||
        result.VersionId === 'null' ||
        result.ServerSideEncryption !== 'AES256' ||
        result.ContentLength !== input.bytes ||
        result.ContentType !== input.contentType ||
        result.ChecksumSHA256 !== Buffer.from(input.sha256, 'hex').toString('base64')
      )
        throw unverified();
      if (!result.Body || !(Symbol.asyncIterator in result.Body)) throw new Error('Missing upload stream');
      const output = new Uint8Array(input.bytes);
      let offset = 0;
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        if (controller.signal.aborted) throw new Error('Upload deadline exceeded');
        if (!(chunk instanceof Uint8Array) || offset + chunk.length > output.length) throw unverified();
        output.set(chunk, offset);
        offset += chunk.length;
      }
      if (controller.signal.aborted) throw new Error('Upload deadline exceeded');
      if (offset !== output.length || createHash('sha256').update(output).digest('hex') !== input.sha256)
        throw unverified();
      return output;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      // Missing objects require a new transfer; provider/network failures can be
      // retried against the same uploaded key without retransmitting the file.
      if (error instanceof Error && error.name === 'NoSuchKey') throw unverified();
      throw new DomainError(
        'DOCUMENT_STORAGE_UNAVAILABLE',
        'Document verification is temporarily unavailable. Retry verification shortly.',
        503,
      );
    } finally {
      // Close a rejected/unfinished network stream as well as the deadline timer.
      discard?.();
      controller.abort();
      clearTimeout(timeout);
    }
  }
}
