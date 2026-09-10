import { expect, test, vi } from 'vitest';
import { sendDriverDocument } from './document-upload';
function fixture() {
  const file = new Blob(['%PDF-1.7 synthetic'], { type: 'application/pdf' });
  const reservation = {
    id: crypto.randomUUID(),
    kind: 'driver_license',
    contentType: file.type,
    bytes: file.size,
    sha256: 'a'.repeat(64),
  };
  const key = `driver-documents/inbox/${reservation.id}/${crypto.randomUUID()}`;
  const target = {
    documentId: reservation.id,
    key,
    url: 'https://rove-private-fixture.s3.us-east-2.amazonaws.com/',
    fields: { key, Policy: 'synthetic-policy' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const transport = vi.fn(async () => new Response('', { status: 201 }));
  return { file, reservation, target, transport };
}
test('uploads multipart file last without API authorization or cookies', async () => {
  const f = fixture();
  const transport = vi.fn(async (_url: string, options: RequestInit) => {
    expect(options.headers).toBeUndefined();
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
    expect([...(options.body as FormData).keys()].at(-1)).toBe('file');
    expect(((options.body as FormData).get('file') as File).name).toBe('document');
    return new Response('', { status: 201 });
  });
  await sendDriverDocument(f.target, f.reservation, f.file, undefined, transport);
  expect(transport).toHaveBeenCalledTimes(1);
});
test.each([
  'http://rove-private-fixture.s3.us-east-2.amazonaws.com/',
  'https://attacker.example/',
  'https://rove-private-fixture.s3.us-east-2.amazonaws.com.evil.test/',
])('blocks untrusted target %s', async (url) => {
  const f = fixture();
  await expect(
    sendDriverDocument({ ...f.target, url }, f.reservation, f.file, undefined, f.transport),
  ).rejects.toThrow();
  expect(f.transport).not.toHaveBeenCalled();
});
test('expired, wrong-owner and changed-file requests never transfer', async () => {
  const f = fixture();
  for (const target of [
    { ...f.target, expiresAt: new Date(0).toISOString() },
    { ...f.target, documentId: crypto.randomUUID() },
    { ...f.target, fields: { key: 'public/file' } },
  ])
    await expect(sendDriverDocument(target, f.reservation, f.file, undefined, f.transport)).rejects.toThrow();
  await expect(
    sendDriverDocument(f.target, f.reservation, new Blob(['different']), undefined, f.transport),
  ).rejects.toThrow();
  expect(f.transport).not.toHaveBeenCalled();
});
test('storage failure is not automatically retried and provider details stay private', async () => {
  const f = fixture();
  f.transport.mockRejectedValue(new Error('private-signed-upload-details'));
  await expect(
    sendDriverDocument(f.target, f.reservation, f.file, undefined, f.transport),
  ).rejects.toMatchObject({ code: 'DOCUMENT_TRANSFER_FAILED' });
  expect(f.transport).toHaveBeenCalledTimes(1);
});
test('already-cancelled upload never sends a file', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    sendDriverDocument(f.target, f.reservation, f.file, controller.signal, f.transport),
  ).rejects.toMatchObject({ code: 'DOCUMENT_TRANSFER_FAILED' });
  expect(f.transport).not.toHaveBeenCalled();
});
