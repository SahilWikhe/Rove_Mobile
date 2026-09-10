import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { S3DocumentDownloads } from './s3-document-download';
const config = { bucket: 'rove-private-fixture', region: 'us-east-2', ownerAccountId: '123456789012' };
function fixture() {
  const client = new S3Client({
    region: config.region,
    credentials: { accessKeyId: 'SYNTHETICACCESSKEY', secretAccessKey: 'synthetic-not-a-real-secret' },
  });
  const documentId = randomUUID();
  return {
    downloads: new S3DocumentDownloads(config, client, () => new Date('2026-09-10T12:00:00Z')),
    target: {
      documentId,
      key: `driver-documents/quarantine/${documentId}/${randomUUID()}`,
      version: 'synthetic-version',
      contentType: 'application/pdf',
    },
  };
}
test('download signs exact version, owner, attachment headers and a 60-second lifetime', async () => {
  const { downloads, target } = fixture();
  try {
    const result = await downloads.issue(target);
    const url = new URL(result.url);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('rove-private-fixture.s3.us-east-2.amazonaws.com');
    expect(decodeURIComponent(url.pathname)).toBe('/' + target.key);
    expect(url.searchParams.get('versionId')).toBe(target.version);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('x-amz-expected-bucket-owner')).toBe(config.ownerAccountId);
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="rove-document.pdf"',
    );
    expect(url.searchParams.get('response-cache-control')).toContain('no-store');
    expect(result.expiresAt).toBe('2026-09-10T12:01:00.000Z');
    expect(result.url).not.toContain('synthetic-not-a-real-secret');
  } finally {
    downloads.close();
  }
});
test('cannot sign inbox files, arbitrary paths, mismatched ids or unversioned content', async () => {
  const { downloads, target } = fixture();
  try {
    for (const change of [
      { key: target.key.replace('/quarantine/', '/inbox/') },
      { key: 'https://other.example/file' },
      { documentId: randomUUID() },
      { version: 'null' },
      { contentType: 'text/html' },
    ]) {
      await expect(downloads.issue({ ...target, ...change })).rejects.toThrow();
    }
  } finally {
    downloads.close();
  }
});
