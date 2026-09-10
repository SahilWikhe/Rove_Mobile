import { createHash, randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import {
  quarantineDriverDocument,
  MAX_DRIVER_DOCUMENT_BYTES,
  type DocumentQuarantineStore,
} from './document-intake';
const samples = {
  'image/png': Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
  'image/jpeg': Uint8Array.from([255, 216, 255, 224, 1]),
  'application/pdf': new TextEncoder().encode('%PDF-1.7 synthetic fixture'),
};
function fixture(contentType: keyof typeof samples = 'application/pdf') {
  const body = samples[contentType];
  const input = {
    driverId: randomUUID(),
    documentId: randomUUID(),
    kind: 'driver_license',
    contentType,
    expectedSha256: createHash('sha256').update(body).digest('hex'),
  };
  const put = vi.fn<DocumentQuarantineStore['put']>(async (value) => ({
    version: 'immutable-version',
    sha256: value.sha256,
    bytes: value.body.byteLength,
  }));
  return { body, input, put };
}
test.each(Object.keys(samples) as Array<keyof typeof samples>)(
  'stores %s as quarantined, never approved or public',
  async (type) => {
    const f = fixture(type);
    const result = await quarantineDriverDocument(f.input, f.body, f);
    expect(result).toMatchObject({
      state: 'quarantined',
      sha256: f.input.expectedSha256,
      version: 'immutable-version',
    });
    expect(result).not.toHaveProperty('url');
    expect(result.key).not.toContain(f.input.driverId);
    expect(f.put).toHaveBeenCalledWith(expect.objectContaining({ ifAbsent: true, contentType: type }));
  },
);
test.each([new Uint8Array(0), new Uint8Array(MAX_DRIVER_DOCUMENT_BYTES + 1)])(
  'rejects empty or oversized input before storage',
  async (body) => {
    const f = fixture();
    await expect(quarantineDriverDocument(f.input, body, f)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT_SIZE',
    });
    expect(f.put).not.toHaveBeenCalled();
  },
);
test('rejects disguised content and checksums before storage', async () => {
  const f = fixture();
  await expect(
    quarantineDriverDocument(f.input, new TextEncoder().encode('<html>not a PDF</html>'), f),
  ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_TYPE' });
  await expect(
    quarantineDriverDocument({ ...f.input, expectedSha256: '0'.repeat(64) }, f.body, f),
  ).rejects.toMatchObject({ code: 'DOCUMENT_CHECKSUM_MISMATCH' });
  expect(f.put).not.toHaveBeenCalled();
});
test('refuses user-supplied paths and unsupported document types', async () => {
  const f = fixture();
  await expect(
    quarantineDriverDocument({ ...f.input, key: 'public/identity.pdf' }, f.body, f),
  ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  await expect(
    quarantineDriverDocument({ ...f.input, contentType: 'image/svg+xml' }, f.body, f),
  ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  expect(f.put).not.toHaveBeenCalled();
});
test('storage failure does not leak raw provider information', async () => {
  const f = fixture();
  f.put.mockRejectedValue(new Error('private-storage-url?secret=fixture'));
  await expect(quarantineDriverDocument(f.input, f.body, f)).rejects.toMatchObject({
    code: 'DOCUMENT_STORAGE_UNAVAILABLE',
  });
  await expect(quarantineDriverDocument(f.input, f.body, f)).rejects.not.toThrow('secret');
});
test('refuses a storage receipt for different bytes', async () => {
  const f = fixture();
  f.put.mockResolvedValue({ version: 'v1', sha256: '0'.repeat(64), bytes: f.body.length });
  await expect(quarantineDriverDocument(f.input, f.body, f)).rejects.toMatchObject({
    code: 'DOCUMENT_STORAGE_UNAVAILABLE',
  });
});
test('freezes caller-owned bytes before asynchronous storage', async () => {
  const f = fixture();
  const body = Uint8Array.from(f.body);
  f.put.mockImplementation(async (input) => {
    body.fill(0);
    expect(createHash('sha256').update(input.body).digest('hex')).toBe(f.input.expectedSha256);
    return { version: 'v1', sha256: input.sha256, bytes: input.body.length };
  });
  await expect(quarantineDriverDocument(f.input, body, f)).resolves.toMatchObject({ state: 'quarantined' });
});
