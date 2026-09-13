import type { S3DocumentInventory } from './s3-document-inventory';
import { randomUUID } from 'node:crypto';
import { test, expect, vi } from 'vitest';
import { S3DocumentErasure, type S3DocumentErasureOperations } from './s3-document-erasure';
const config = { bucket: 'rove-private-fixture', region: 'us-east-2', ownerAccountId: '123456789012' };
function fixture() {
  const documentId = randomUUID();
  const input = {
    documentId,
    key: `driver-documents/quarantine/${documentId}/${randomUUID()}`,
    version: 'immutable-version',
  };
  let present = true;
  const operations = {
    versioning: vi.fn<S3DocumentErasureOperations['versioning']>(async () => ({
      $metadata: {},
      Status: 'Enabled',
    })),
    remove: vi.fn<S3DocumentErasureOperations['remove']>(async () => {
      present = false;
      return { $metadata: { httpStatusCode: 204 }, VersionId: input.version };
    }),
  };
  const inventory = {
    discover: vi.fn<S3DocumentInventory['discover']>(async () =>
      present ? [{ documentId, key: input.key, version: input.version, kind: 'object' }] : [],
    ),
  };
  return {
    input,
    operations,
    inventory,
    provider: new S3DocumentErasure(config, operations, undefined, inventory),
  };
}
test('removes only the bound version and independently verifies absence; retry makes no second delete', async () => {
  const f = fixture();
  expect(await f.provider.erase(f.input)).toEqual({ status: 'absent' });
  const target = {
    Bucket: config.bucket,
    ExpectedBucketOwner: config.ownerAccountId,
    Key: f.input.key,
    VersionId: f.input.version,
  };
  expect(f.operations.remove).toHaveBeenCalledWith(target, expect.any(AbortSignal));
  expect(f.inventory.discover).toHaveBeenNthCalledWith(1, f.input.documentId);
  expect(f.inventory.discover).toHaveBeenNthCalledWith(2, f.input.documentId);
  expect(await f.provider.erase(f.input)).toEqual({ status: 'absent' });
  expect(f.operations.remove).toHaveBeenCalledTimes(1);
});
test.each(['', 'null'])('rejects unsafe version %s before storage calls', async (version) => {
  const f = fixture();
  await expect(f.provider.erase({ ...f.input, version })).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  expect(f.operations.versioning).not.toHaveBeenCalled();
});
test('rejects cross-document, malformed and extra target fields before dispatch', async () => {
  const f = fixture();
  for (const raw of [
    { ...f.input, documentId: randomUUID() },
    { ...f.input, key: f.input.key + '/extra' },
    { ...f.input, bucket: 'other-bucket' },
  ]) {
    await expect(f.provider.erase(raw)).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  }
  expect(f.operations.remove).not.toHaveBeenCalled();
});
test.each([undefined, 'Suspended'] as const)('fails closed when bucket versioning is %s', async (Status) => {
  const f = fixture();
  f.operations.versioning.mockResolvedValue({ $metadata: {}, Status });
  await expect(f.provider.erase(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_ERASURE_UNAVAILABLE' });
  expect(f.inventory.discover).not.toHaveBeenCalled();
});
test.each([
  { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } },
  { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } },
  { name: 'NotFound', $metadata: { httpStatusCode: 500 } },
  { name: 'NotFound' },
  { name: 'NotFound', $metadata: { httpStatusCode: 404 }, DeleteMarker: true },
])('does not confuse provider failure or delete markers with absence: %j', async (error) => {
  const f = fixture();
  f.inventory.discover.mockRejectedValue(error);
  await expect(f.provider.erase(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_ERASURE_UNAVAILABLE' });
  expect(f.operations.remove).not.toHaveBeenCalled();
});
test('a target that is a delete marker is not an erasable document version', async () => {
  const f = fixture();
  f.inventory.discover.mockResolvedValue([{ ...f.input, kind: 'delete_marker' }]);
  await expect(f.provider.erase(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_ERASURE_UNAVAILABLE' });
  expect(f.operations.remove).not.toHaveBeenCalled();
});
test('other versions and other keys do not cause a second deletion of an absent target', async () => {
  const f = fixture();
  f.inventory.discover.mockResolvedValue([
    { ...f.input, version: 'another-version', kind: 'object' },
    { ...f.input, key: f.input.key + '-other', kind: 'object' },
  ]);
  expect(await f.provider.erase(f.input)).toEqual({ status: 'absent' });
  expect(f.operations.remove).not.toHaveBeenCalled();
});
test('does not accept deletion receipt when the exact version still exists', async () => {
  const f = fixture();
  f.operations.remove.mockResolvedValue({ $metadata: { httpStatusCode: 204 }, VersionId: f.input.version });
  await expect(f.provider.erase(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_ERASURE_UNAVAILABLE' });
});
test('lost delete response recovers by verifying absence without another mutation', async () => {
  const f = fixture();
  const remove = f.operations.remove.getMockImplementation()!;
  f.operations.remove.mockImplementation(async (...args) => {
    await remove(...args);
    throw new Error('private-provider-detail');
  });
  await expect(f.provider.erase(f.input)).rejects.not.toThrow('private-provider-detail');
  expect(await f.provider.erase(f.input)).toEqual({ status: 'absent' });
  expect(f.operations.remove).toHaveBeenCalledTimes(1);
});
test.each([
  { VersionId: undefined },
  { VersionId: 'wrong' },
  { DeleteMarker: true },
  { $metadata: { httpStatusCode: 200 } },
])('rejects an unverified delete receipt: %j', async (override) => {
  const f = fixture();
  f.operations.remove.mockResolvedValue({
    $metadata: { httpStatusCode: 204 },
    VersionId: f.input.version,
    ...override,
  });
  await expect(f.provider.erase(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_ERASURE_UNAVAILABLE' });
});
test('Object Lock or permission denial stays a failure without bypass options', async () => {
  const f = fixture();
  f.operations.remove.mockRejectedValue(Object.assign(new Error('sensitive'), { name: 'AccessDenied' }));
  await expect(f.provider.erase(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_ERASURE_UNAVAILABLE' });
  expect(f.operations.remove.mock.calls[0]![0]).not.toHaveProperty('BypassGovernanceRetention');
});

test('also removes bound inbox versions without permitting arbitrary storage prefixes', async () => {
  const f = fixture();
  f.input.key = f.input.key.replace('/quarantine/', '/inbox/');
  await expect(f.provider.erase(f.input)).resolves.toEqual({ status: 'absent' });
  expect(f.operations.remove.mock.calls[0]![0].Key).toContain('/inbox/');
  const other = fixture();
  await expect(
    other.provider.erase({ ...other.input, key: other.input.key.replace('/quarantine/', '/public/') }),
  ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  expect(other.operations.remove).not.toHaveBeenCalled();
});
