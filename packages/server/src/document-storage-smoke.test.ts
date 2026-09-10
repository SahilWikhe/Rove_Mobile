import { randomUUID } from 'node:crypto';
import { test, expect, vi } from 'vitest';
import { documentStorageSmoke, type DocumentSmokePorts } from './document-storage-smoke';
const config = { bucket: 'rove-staging-fixture', region: 'us-east-2', ownerAccountId: '123456789012' };
function fixture() {
  let uploaded = new Uint8Array();
  const tags = vi.fn(async () => ({
    Application: 'Rove',
    Environment: 'staging',
    DataClassification: 'PrivateDriverDocuments',
  }));
  const issue = vi.fn(async (raw: unknown) => {
    const input = raw as { id: string; expiresAt: string };
    const key = `driver-documents/inbox/${input.id}/${randomUUID()}`;
    return {
      documentId: input.id,
      key,
      url: `https://${config.bucket}.s3.${config.region}.amazonaws.com/`,
      fields: { key, Policy: 'synthetic-policy' },
      expiresAt: input.expiresAt,
    };
  });
  const transfer = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') {
      const file = (init.body as FormData).get('file') as Blob;
      uploaded = new Uint8Array(await file.arrayBuffer());
      return new Response('', { status: 201 });
    }
    return new Response('', { status: 403 });
  });
  const read = vi.fn(async () => uploaded);
  const put = vi.fn<DocumentSmokePorts['quarantine']['put']>(async (input) => ({
    version: 'synthetic-version',
    bytes: input.body.length,
    sha256: input.sha256,
  }));
  return {
    tags,
    issue,
    transfer,
    read,
    put,
    ports: { tags, issue, fetch: transfer, read, quarantine: { put } } as DocumentSmokePorts,
  };
}
test('checks staging tags, signed transfer, round-trip bytes, quarantine receipt and anonymous denial', async () => {
  const f = fixture();
  expect(await documentStorageSmoke(config, f.ports)).toMatchObject({
    status: 'verified',
    quarantineVersion: 'synthetic-version',
  });
  expect(f.put).toHaveBeenCalledOnce();
  expect(f.transfer).toHaveBeenCalledTimes(3);
  expect(f.transfer.mock.calls[0]?.[1]).toMatchObject({
    credentials: 'omit',
    redirect: 'error',
    method: 'POST',
  });
  expect(f.put.mock.calls[0]?.[0]).toMatchObject({ ifAbsent: true, contentType: 'application/pdf' });
});
test('refuses a production bucket before generating a signed form or writing', async () => {
  const f = fixture();
  f.tags.mockResolvedValue({
    Application: 'Rove',
    Environment: 'production',
    DataClassification: 'PrivateDriverDocuments',
  });
  await expect(documentStorageSmoke(config, f.ports)).rejects.toThrow('Refusing writes');
  expect(f.issue).not.toHaveBeenCalled();
  expect(f.transfer).not.toHaveBeenCalled();
});
test('rejects an unexpected destination before transferring bytes', async () => {
  const f = fixture();
  const issue = f.ports.issue;
  f.ports.issue = async (input) => ({
    ...((await issue(input)) as object),
    url: 'https://attacker.example/',
  });
  await expect(documentStorageSmoke(config, f.ports)).rejects.toThrow('unexpected upload');
  expect(f.transfer).not.toHaveBeenCalled();
});
test('failed upload does not reach quarantine', async () => {
  const f = fixture();
  f.transfer.mockResolvedValue(new Response('', { status: 403 }));
  await expect(documentStorageSmoke(config, f.ports)).rejects.toThrow('not accepted');
  expect(f.read).not.toHaveBeenCalled();
  expect(f.put).not.toHaveBeenCalled();
});
test('changed round-trip bytes never reach quarantine', async () => {
  const f = fixture();
  f.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
  await expect(documentStorageSmoke(config, f.ports)).rejects.toThrow('changed');
  expect(f.put).not.toHaveBeenCalled();
});
test('does not report success if the object is anonymously readable', async () => {
  const f = fixture();
  const transport = f.ports.fetch;
  f.ports.fetch = (url, init) =>
    init?.method === 'POST' ? transport(url, init) : Promise.resolve(new Response('public', { status: 200 }));
  await expect(documentStorageSmoke(config, f.ports)).rejects.toThrow('Anonymous access');
});

test('optional uploader checks must pass before reporting restricted verification', async () => {
  const f = fixture();
  const verifyUploaderRestrictions = vi.fn().mockRejectedValue(new Error('unexpected access'));
  await expect(documentStorageSmoke(config, { ...f.ports, verifyUploaderRestrictions })).rejects.toThrow(
    'unexpected access',
  );
  expect(verifyUploaderRestrictions).toHaveBeenCalledWith(
    expect.objectContaining({ version: 'synthetic-version' }),
  );
});
