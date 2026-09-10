import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { S3Client, GetBucketVersioningCommand } from '@aws-sdk/client-s3';
import { S3DocumentUploadForms } from './s3-document-upload';
const config = { bucket: 'rove-private-fixture', region: 'us-east-2', ownerAccountId: '123456789012' };
function fixture() {
  const client = new S3Client({
    region: config.region,
    credentials: { accessKeyId: 'SYNTHETICACCESSKEY', secretAccessKey: 'synthetic-not-a-real-secret' },
  });
  const send = vi.spyOn(client, 'send').mockImplementation(async (command: unknown) =>
    command instanceof GetBucketVersioningCommand
      ? { Status: 'Enabled', $metadata: {} }
      : {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
          $metadata: {},
        },
  );
  const input = {
    id: randomUUID(),
    kind: 'driver_license',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    bytes: 100,
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  };
  return { client, send, input, forms: new S3DocumentUploadForms(config, client) };
}
test('signs an exact size, type, checksum and private path with a short lifetime', async () => {
  const f = fixture();
  const result = await f.forms.issue(f.input);
  const policy = JSON.parse(Buffer.from(result.fields.Policy!, 'base64').toString());
  expect(result.key).toMatch(new RegExp(`^driver-documents/inbox/${f.input.id}/[a-f0-9-]+$`));
  expect(policy.conditions).toEqual(
    expect.arrayContaining([
      ['content-length-range', 100, 100],
      { 'Content-Type': 'application/pdf' },
      { 'x-amz-checksum-sha256': Buffer.from(f.input.sha256, 'hex').toString('base64') },
      { 'x-amz-server-side-encryption': 'AES256' },
      { key: result.key },
      { bucket: config.bucket },
    ]),
  );
  expect(Date.parse(policy.expiration)).toBeLessThanOrEqual(Date.now() + 120_000);
  expect(JSON.stringify(result)).not.toContain('synthetic-not-a-real-secret');
});
test('expired and oversized requests cannot trigger storage access', async () => {
  const f = fixture();
  await expect(f.forms.issue({ ...f.input, expiresAt: new Date(0).toISOString() })).rejects.toMatchObject({
    code: 'DOCUMENT_EXPIRED',
  });
  await expect(f.forms.issue({ ...f.input, bytes: 11 * 1024 * 1024 })).rejects.toThrow();
  expect(f.send).not.toHaveBeenCalled();
});
test('refuses a bucket without private access controls and redacts provider errors', async () => {
  const f = fixture();
  f.send.mockResolvedValue({ Status: 'Enabled', $metadata: {} } as never);
  await expect(f.forms.issue(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_STORAGE_UNAVAILABLE' });
  f.send.mockRejectedValue(new Error('provider-secret'));
  await expect(f.forms.issue(f.input)).rejects.not.toThrow('provider-secret');
});

test('upload form cannot outlive a nearly expired reservation', async () => {
  const f = fixture();
  const expiresAt = new Date(Date.now() + 20_000).toISOString();
  const result = await f.forms.issue({ ...f.input, expiresAt });
  const policy = JSON.parse(Buffer.from(result.fields.Policy!, 'base64').toString());
  expect(Date.parse(policy.expiration)).toBeLessThanOrEqual(Date.parse(expiresAt));
});
test('unversioned buckets cannot receive a signed form', async () => {
  const f = fixture();
  f.send.mockResolvedValue({ Status: 'Suspended', $metadata: {} } as never);
  await expect(f.forms.issue(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_STORAGE_UNAVAILABLE' });
});
