import { test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HeadObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { verifyUploaderRestrictions } from './document-storage-permissions-check';
const config = { bucket: 'rove-staging-fixture', region: 'us-east-2', ownerAccountId: '123456789012' };
const receipt = {
  key: `driver-documents/quarantine/${randomUUID()}/${randomUUID()}`,
  version: 'fixture-version',
};
const denied = () =>
  Object.assign(new Error('private provider details'), {
    name: 'AccessDenied',
    $metadata: { httpStatusCode: 403 },
  });
function fixture() {
  const send = vi.fn().mockRejectedValue(denied());
  return { send, client: { send } as unknown as Pick<S3Client, 'send'> };
}
test('requires explicit denial for both listing and the exact existing quarantine version', async () => {
  const f = fixture();
  await verifyUploaderRestrictions(f.client, config, receipt);
  expect(f.send).toHaveBeenCalledTimes(2);
  expect(f.send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectsV2Command);
  expect(f.send.mock.calls[1]?.[0]).toBeInstanceOf(HeadObjectCommand);
  expect(f.send.mock.calls[1]?.[0].input).toMatchObject({
    ExpectedBucketOwner: config.ownerAccountId,
    Key: receipt.key,
    VersionId: receipt.version,
  });
});
test.each([0, 1])('rejects unexpected permission at check %i', async (index) => {
  const f = fixture();
  if (index) f.send.mockRejectedValueOnce(denied());
  f.send.mockResolvedValueOnce({});
  await expect(verifyUploaderRestrictions(f.client, config, receipt)).rejects.toThrow('unexpected');
});
test.each([
  new Error('network failure'),
  Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }),
  Object.assign(new Error('not authorized'), { name: 'AccessDenied', $metadata: { httpStatusCode: 500 } }),
])('does not confuse provider failures with denied access', async (error) => {
  const f = fixture();
  f.send.mockRejectedValue(error);
  await expect(verifyUploaderRestrictions(f.client, config, receipt)).rejects.toThrow(
    'could not be verified',
  );
});
test('invalid receipt triggers no cloud requests', async () => {
  const f = fixture();
  await expect(
    verifyUploaderRestrictions(f.client, config, { ...receipt, key: 'other/path' }),
  ).rejects.toThrow('Invalid');
  expect(f.send).not.toHaveBeenCalled();
});

test('accepts bodyless HEAD authorization denial without an XML error name', async () => {
  const f = fixture();
  f.send
    .mockRejectedValueOnce(denied())
    .mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { name: 'Unknown', $metadata: { httpStatusCode: 403 } }),
    );
  await expect(verifyUploaderRestrictions(f.client, config, receipt)).resolves.toBeUndefined();
});
