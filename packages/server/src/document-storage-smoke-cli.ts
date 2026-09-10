import { parseArgs } from 'node:util';
import { S3Client, GetBucketTaggingCommand } from '@aws-sdk/client-s3';
import { S3DocumentConfig } from './s3-document-config';
import { S3DocumentUploadForms } from './s3-document-upload';
import { S3DocumentInbox } from './s3-document-inbox';
import { S3DocumentStore } from './s3-document-store';
import { documentStorageSmoke } from './document-storage-smoke';

try {
  const { values } = parseArgs({
    options: {
      bucket: { type: 'string' },
      region: { type: 'string' },
      owner: { type: 'string' },
      'confirm-synthetic-write': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values['confirm-synthetic-write']) throw new Error('Explicit synthetic-write confirmation required.');
  const config = S3DocumentConfig.parse({
    bucket: values.bucket,
    region: values.region,
    ownerAccountId: values.owner,
  });
  const client = new S3Client({ region: config.region, maxAttempts: 2, ignoreConfiguredEndpointUrls: true });
  const forms = new S3DocumentUploadForms(config, client);
  const inbox = new S3DocumentInbox(config, client);
  try {
    const result = await documentStorageSmoke(config, {
      tags: async () => {
        const result = await client.send(
          new GetBucketTaggingCommand({ Bucket: config.bucket, ExpectedBucketOwner: config.ownerAccountId }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        return Object.fromEntries(
          (result.TagSet ?? []).filter((tag) => tag.Key && tag.Value).map((tag) => [tag.Key!, tag.Value!]),
        );
      },
      issue: (input) => forms.issue(input),
      read: (input) => inbox.read(input),
      quarantine: new S3DocumentStore(config),
      fetch,
    });
    console.log(JSON.stringify(result));
    console.log(
      'Synthetic objects remain in staging quarantine/inbox; this does not verify malware scanning or approval.',
    );
  } finally {
    client.destroy();
  }
} catch {
  console.error(
    'Storage smoke check failed. Verify explicit staging arguments, AWS access, bucket policy and storage configuration. Provider details are withheld.',
  );
  process.exitCode = 1;
}
