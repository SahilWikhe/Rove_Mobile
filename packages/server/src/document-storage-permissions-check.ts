import { HeadObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { S3DocumentConfig } from './s3-document-config';
import { z } from 'zod';

/** Run only with an uploader identity: reviewer identities deliberately have additional access. */
export async function verifyUploaderRestrictions(
  client: Pick<S3Client, 'send'>,
  rawConfig: unknown,
  input: { key: string; version: string },
) {
  const config = S3DocumentConfig.parse(rawConfig);
  const parts = input.key.split('/');
  if (
    parts.length !== 4 ||
    parts[0] !== 'driver-documents' ||
    parts[1] !== 'quarantine' ||
    !z.uuid().safeParse(parts[2]).success ||
    !z.uuid().safeParse(parts[3]).success ||
    !input.version ||
    input.version === 'null'
  )
    throw new Error('Invalid quarantine receipt.');
  const target = { Bucket: config.bucket, ExpectedBucketOwner: config.ownerAccountId };
  const checks = [
    () =>
      client.send(new ListObjectsV2Command({ ...target, MaxKeys: 1 }), {
        abortSignal: AbortSignal.timeout(10_000),
      }),
    () =>
      client.send(new HeadObjectCommand({ ...target, Key: input.key, VersionId: input.version }), {
        abortSignal: AbortSignal.timeout(10_000),
      }),
  ];
  for (const check of checks) {
    try {
      await check();
    } catch (error) {
      // Only an explicit S3 authorization denial proves the restriction. Timeouts and 404s do not.
      if (
        error instanceof Error &&
        '$metadata' in error &&
        (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 403
      )
        continue;
      // Provider errors may contain signed request details; keep this operator result sanitized.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Uploader restriction could not be verified.');
    }
    throw new Error('Uploader identity has unexpected read or listing access.');
  }
}
