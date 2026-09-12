import { randomUUID } from 'node:crypto';
import { test, expect, vi } from 'vitest';
import { S3DocumentInventory, type S3DocumentInventoryOperations } from './s3-document-inventory';
const config = { bucket: 'rove-private-fixture', region: 'us-east-2', ownerAccountId: '123456789012' };
function fixture() {
  const id = randomUUID(),
    attempt = randomUUID();
  const prefix = `driver-documents/inbox/${id}/`,
    key = prefix + attempt;
  const operations = {
    list: vi.fn<S3DocumentInventoryOperations['list']>(async (input) => ({
      $metadata: { httpStatusCode: 200 },
      Name: config.bucket,
      Prefix: input.Prefix,
      IsTruncated: false,
    })),
  };
  return { id, prefix, key, operations, provider: new S3DocumentInventory(config, operations) };
}
test('discovers orphan versions and delete markers across both document prefixes with dual-marker pagination', async () => {
  const f = fixture();
  f.operations.list
    .mockResolvedValueOnce({
      $metadata: { httpStatusCode: 200 },
      Name: config.bucket,
      Prefix: f.prefix,
      IsTruncated: true,
      NextKeyMarker: f.key,
      NextVersionIdMarker: 'v1',
      Versions: [{ Key: f.key, VersionId: 'v1' }],
    })
    .mockResolvedValueOnce({
      $metadata: { httpStatusCode: 200 },
      Name: config.bucket,
      Prefix: f.prefix,
      IsTruncated: false,
      Versions: [{ Key: f.key, VersionId: 'v0' }],
      DeleteMarkers: [{ Key: f.key, VersionId: 'marker' }],
    });
  const rows = await f.provider.discover(f.id);
  expect(rows.map((r) => [r.version, r.kind])).toEqual([
    ['v1', 'object'],
    ['v0', 'object'],
    ['marker', 'delete_marker'],
  ]);
  expect(f.operations.list).toHaveBeenNthCalledWith(
    2,
    {
      Bucket: config.bucket,
      ExpectedBucketOwner: config.ownerAccountId,
      Prefix: f.prefix,
      MaxKeys: 1000,
      KeyMarker: f.key,
      VersionIdMarker: 'v1',
    },
    expect.any(AbortSignal),
  );
  expect(f.operations.list.mock.calls[2]![0].Prefix).toBe(`driver-documents/quarantine/${f.id}/`);
  expect(f.operations.list.mock.calls[2]![0]).not.toHaveProperty('KeyMarker');
});
test('empty complete inventories return no versions', async () => {
  const f = fixture();
  expect(await f.provider.discover(f.id)).toEqual([]);
  expect(f.operations.list).toHaveBeenCalledTimes(2);
});
test('invalid document ID makes no storage request', async () => {
  const f = fixture();
  await expect(f.provider.discover('../other')).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  expect(f.operations.list).not.toHaveBeenCalled();
});
test.each([
  { Name: 'wrong-bucket' },
  { Prefix: 'driver-documents/' },
  { IsTruncated: undefined },
  { $metadata: { httpStatusCode: 403 } },
  { EncodingType: 'url' as const },
  { CommonPrefixes: [{ Prefix: 'hidden' }] },
  { IsTruncated: true },
])('rejects incomplete or differently scoped inventory: %j', async (override) => {
  const f = fixture();
  f.operations.list.mockResolvedValue({
    $metadata: { httpStatusCode: 200 },
    Name: config.bucket,
    Prefix: f.prefix,
    IsTruncated: false,
    ...override,
  });
  await expect(f.provider.discover(f.id)).rejects.toMatchObject({ code: 'DOCUMENT_INVENTORY_UNAVAILABLE' });
});
test.each(['null', ''])('rejects unbound version %s', async (VersionId) => {
  const f = fixture();
  f.operations.list.mockResolvedValue({
    $metadata: { httpStatusCode: 200 },
    Name: config.bucket,
    Prefix: f.prefix,
    IsTruncated: false,
    Versions: [{ Key: f.key, VersionId }],
  });
  await expect(f.provider.discover(f.id)).rejects.toMatchObject({ code: 'DOCUMENT_INVENTORY_UNAVAILABLE' });
});
test('rejects cross-document and nested keys', async () => {
  for (const wrong of ['driver-documents/inbox/' + randomUUID() + '/' + randomUUID(), 'nested/path']) {
    const f = fixture();
    f.operations.list.mockResolvedValue({
      $metadata: { httpStatusCode: 200 },
      Name: config.bucket,
      Prefix: f.prefix,
      IsTruncated: false,
      Versions: [{ Key: wrong, VersionId: 'v1' }],
    });
    await expect(f.provider.discover(f.id)).rejects.toMatchObject({ code: 'DOCUMENT_INVENTORY_UNAVAILABLE' });
  }
});
test('fails instead of looping on a repeated cursor', async () => {
  const f = fixture();
  f.operations.list.mockResolvedValue({
    $metadata: { httpStatusCode: 200 },
    Name: config.bucket,
    Prefix: f.prefix,
    IsTruncated: true,
    NextKeyMarker: f.key,
    NextVersionIdMarker: 'v1',
  });
  await expect(f.provider.discover(f.id)).rejects.toMatchObject({ code: 'DOCUMENT_INVENTORY_UNAVAILABLE' });
  expect(f.operations.list).toHaveBeenCalledTimes(2);
});
test('rejects duplicated version evidence, including conflicts with a delete marker', async () => {
  const f = fixture();
  f.operations.list.mockResolvedValue({
    $metadata: { httpStatusCode: 200 },
    Name: config.bucket,
    Prefix: f.prefix,
    IsTruncated: false,
    Versions: [{ Key: f.key, VersionId: 'v1' }],
    DeleteMarkers: [{ Key: f.key, VersionId: 'v1' }],
  });
  await expect(f.provider.discover(f.id)).rejects.toMatchObject({ code: 'DOCUMENT_INVENTORY_UNAVAILABLE' });
});
test('later-page failure discards all partial results and hides provider details', async () => {
  const f = fixture();
  f.operations.list
    .mockResolvedValueOnce({
      $metadata: { httpStatusCode: 200 },
      Name: config.bucket,
      Prefix: f.prefix,
      IsTruncated: true,
      NextKeyMarker: f.key,
      NextVersionIdMarker: 'v1',
      Versions: [{ Key: f.key, VersionId: 'v1' }],
    })
    .mockRejectedValue(new Error('secret-provider-detail'));
  await expect(f.provider.discover(f.id)).rejects.not.toThrow('secret-provider-detail');
});
test('bounds unexpectedly large inventories instead of returning partial data', async () => {
  const f = fixture();
  f.operations.list.mockResolvedValue({
    $metadata: { httpStatusCode: 200 },
    Name: config.bucket,
    Prefix: f.prefix,
    IsTruncated: false,
    Versions: Array.from({ length: 10001 }, (_, i) => ({ Key: f.key, VersionId: String(i) })),
  });
  await expect(f.provider.discover(f.id)).rejects.toMatchObject({ code: 'DOCUMENT_INVENTORY_UNAVAILABLE' });
});
