import { DocumentWriteNotDispatched } from './document-write-not-dispatched';
import { createHash, randomUUID } from 'node:crypto';
import { test, expect, vi } from 'vitest';
import { S3DocumentStore, type S3DocumentOperations } from './s3-document-store';
const config = { bucket: 'rove-private-fixture', region: 'us-east-2', ownerAccountId: '123456789012' };
function fixture() {
  const body = new TextEncoder().encode('%PDF-1.7 synthetic');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const input = {
    key: `driver-documents/quarantine/${randomUUID()}/${randomUUID()}`,
    body,
    sha256,
    contentType: 'application/pdf' as const,
    ifAbsent: true as const,
  };
  const operations = {
    versioning: vi.fn<S3DocumentOperations['versioning']>(async () => ({ $metadata: {}, Status: 'Enabled' })),
    publicAccess: vi.fn<S3DocumentOperations['publicAccess']>(async () => ({
      $metadata: {},
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })),
    put: vi.fn<S3DocumentOperations['put']>(async () => ({
      $metadata: {},
      VersionId: 'immutable-version',
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      ServerSideEncryption: 'AES256',
    })),
  };
  return { input, operations, store: new S3DocumentStore(config, operations) };
}
test('writes only after private bucket/versioning checks with a conditional encrypted checksum upload', async () => {
  const f = fixture();
  expect(await f.store.put(f.input)).toEqual({
    version: 'immutable-version',
    sha256: f.input.sha256,
    bytes: f.input.body.length,
  });
  expect(f.operations.put).toHaveBeenCalledWith(
    expect.objectContaining({
      ExpectedBucketOwner: config.ownerAccountId,
      IfNoneMatch: '*',
      ServerSideEncryption: 'AES256',
      ContentDisposition: 'attachment',
      CacheControl: 'no-store',
    }),
    expect.any(AbortSignal),
  );
});
test.each(['BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls', 'RestrictPublicBuckets'] as const)(
  'does not upload when %s is disabled',
  async (flag) => {
    const f = fixture();
    const value = await f.operations.publicAccess(new AbortController().signal);
    value.PublicAccessBlockConfiguration![flag] = false;
    f.operations.publicAccess.mockResolvedValue(value);
    await expect(f.store.put(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_STORAGE_UNAVAILABLE' });
    expect(f.operations.put).not.toHaveBeenCalled();
  },
);
test('does not upload into an unversioned bucket', async () => {
  const f = fixture();
  f.operations.versioning.mockResolvedValue({ $metadata: {}, Status: 'Suspended' });
  await expect(f.store.put(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_STORAGE_UNAVAILABLE' });
  expect(f.operations.put).not.toHaveBeenCalled();
});
test.each([{ VersionId: 'null' }, { ChecksumSHA256: 'wrong' }, { ServerSideEncryption: undefined }])(
  'rejects an unverified response: %j',
  async (override) => {
    const f = fixture();
    const response = await f.operations.put(
      { Bucket: config.bucket, Key: f.input.key },
      new AbortController().signal,
    );
    f.operations.put.mockResolvedValue({ ...response, ...override });
    await expect(f.store.put(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_STORAGE_UNAVAILABLE' });
  },
);
test('invalid path or checksum fails before storage requests', async () => {
  const f = fixture();
  await expect(f.store.put({ ...f.input, key: 'public/file.pdf' })).rejects.toMatchObject({
    code: 'INVALID_DOCUMENT',
  });
  await expect(f.store.put({ ...f.input, sha256: '0'.repeat(64) })).rejects.toMatchObject({
    code: 'DOCUMENT_CHECKSUM_MISMATCH',
  });
  expect(f.operations.versioning).not.toHaveBeenCalled();
});
test('provider failure is sanitized and cannot expose storage credentials', async () => {
  const f = fixture();
  f.operations.put.mockRejectedValue(new Error('private-provider-credential'));
  await expect(f.store.put(f.input)).rejects.not.toThrow('private-provider-credential');
});

test('read-only preflight failure has definitive no-dispatch evidence, but put failures never do', async () => {
  const f = fixture();
  f.operations.versioning.mockRejectedValue(new Error('private-preflight-detail'));
  await expect(f.store.put(f.input)).rejects.toBeInstanceOf(DocumentWriteNotDispatched);
  expect(f.operations.put).not.toHaveBeenCalled();
  const g = fixture();
  // Even a misleading error from the write operation cannot escape as no-dispatch proof.
  g.operations.put.mockRejectedValue(new DocumentWriteNotDispatched());
  await expect(g.store.put(g.input)).rejects.not.toBeInstanceOf(DocumentWriteNotDispatched);
  expect(g.operations.put).toHaveBeenCalledTimes(1);
});
