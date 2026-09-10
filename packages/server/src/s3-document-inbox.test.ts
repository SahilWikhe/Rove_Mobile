import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { test, expect, vi } from 'vitest';
import { S3DocumentInbox } from './s3-document-inbox';
const config = { bucket: 'rove-private-fixture', region: 'us-east-2', ownerAccountId: '123456789012' };
function fixture() {
  const body = new TextEncoder().encode('%PDF-1.7 synthetic');
  const id = randomUUID();
  const input = {
    id,
    kind: 'driver_license',
    contentType: 'application/pdf',
    bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    key: `driver-documents/inbox/${id}/${randomUUID()}`,
  };
  const client = new S3Client({ region: config.region });
  const response = {
    Body: Readable.from([body.slice(0, 5), body.slice(5)]),
    VersionId: 'immutable-version',
    ServerSideEncryption: 'AES256',
    ContentLength: body.length,
    ContentType: input.contentType,
    ChecksumSHA256: Buffer.from(input.sha256, 'hex').toString('base64'),
    $metadata: {},
  };
  const send = vi.spyOn(client, 'send').mockResolvedValue(response as never);
  return { input, body, response, send, reader: new S3DocumentInbox(config, client) };
}
test('reads the exact private object with owner and checksum verification', async () => {
  const f = fixture();
  expect(await f.reader.read(f.input)).toEqual(f.body);
  expect(f.send.mock.calls[0]?.[0].input).toMatchObject({
    Key: f.input.key,
    ExpectedBucketOwner: config.ownerAccountId,
    ChecksumMode: 'ENABLED',
  });
});
test.each([
  'public/file.pdf',
  'https://attacker.example/file',
  `driver-documents/inbox/${randomUUID()}/${randomUUID()}`,
])('rejects foreign or arbitrary paths before network: %s', async (key) => {
  const f = fixture();
  await expect(f.reader.read({ ...f.input, key })).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  expect(f.send).not.toHaveBeenCalled();
});
test.each([
  { VersionId: 'null' },
  { ContentLength: 999 },
  { ContentType: 'text/html' },
  { ChecksumSHA256: 'wrong' },
  { ServerSideEncryption: undefined },
])('rejects untrusted object metadata %j', async (override) => {
  const f = fixture();
  f.send.mockResolvedValue({ ...f.response, ...override } as never);
  await expect(f.reader.read(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_UNVERIFIED' });
});
test.each(['oversized', 'truncated', 'corrupt'])(
  'rejects %s stream even when metadata appears valid',
  async (mode) => {
    const f = fixture();
    const bytes =
      mode === 'oversized'
        ? new Uint8Array(f.body.length + 1)
        : mode === 'truncated'
          ? f.body.slice(1)
          : new Uint8Array(f.body.length);
    f.send.mockResolvedValue({ ...f.response, Body: Readable.from([bytes]) } as never);
    await expect(f.reader.read(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_UNVERIFIED' });
  },
);

test.each(['SlowDown', 'AccessDenied', 'TimeoutError', 'AbortError', 'ECONNRESET'])(
  'preserves verification retry on provider failure %s without leaking diagnostics',
  async (name) => {
    const f = fixture();
    f.send.mockRejectedValue(Object.assign(new Error('private bucket and credential details'), { name }));
    await expect(f.reader.read(f.input)).rejects.toMatchObject({
      code: 'DOCUMENT_STORAGE_UNAVAILABLE',
      status: 503,
      message: 'Document verification is temporarily unavailable. Retry verification shortly.',
    });
    f.send.mockResolvedValue(f.response as never);
    expect(await f.reader.read(f.input)).toEqual(f.body);
  },
);
test('a missing inbox object requires another transfer', async () => {
  const f = fixture();
  f.send.mockRejectedValue(Object.assign(new Error('private object path'), { name: 'NoSuchKey' }));
  await expect(f.reader.read(f.input)).rejects.toMatchObject({
    code: 'DOCUMENT_UPLOAD_UNVERIFIED',
    status: 422,
  });
});
test('destroys a rejected response body before it can occupy a pooled connection', async () => {
  const f = fixture();
  f.send.mockResolvedValue({ ...f.response, ContentType: 'text/html' } as never);
  await expect(f.reader.read(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_UNVERIFIED' });
  expect(f.response.Body.destroyed).toBe(true);
});
test('an interrupted download is retryable and does not return partial document bytes', async () => {
  const f = fixture();
  const interrupted = Readable.from(
    (async function* () {
      yield f.body.slice(0, 5);
      throw new Error('private provider details');
    })(),
  );
  f.send.mockResolvedValue({ ...f.response, Body: interrupted } as never);
  await expect(f.reader.read(f.input)).rejects.toMatchObject({
    code: 'DOCUMENT_STORAGE_UNAVAILABLE',
    status: 503,
  });
  expect(interrupted.destroyed).toBe(true);
});
