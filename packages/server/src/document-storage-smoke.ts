import { createHash, randomUUID } from 'node:crypto';
import { DriverDocumentUploadTarget } from '@rove/contracts';
import { z } from 'zod';
import { S3DocumentConfig } from './s3-document-config';
import { quarantineDriverDocument, type DocumentQuarantineStore } from './document-intake';

export interface DocumentSmokePorts {
  tags(): Promise<Record<string, string>>;
  issue(input: unknown): Promise<unknown>;
  read(input: unknown): Promise<Uint8Array>;
  quarantine: DocumentQuarantineStore;
  fetch: typeof fetch;
  verifyUploaderRestrictions?(input: { key: string; version: string }): Promise<void>;
}
/** Operator-only synthetic storage check. Never accepts user files or connects to the ride database. */
export async function documentStorageSmoke(raw: unknown, ports: DocumentSmokePorts) {
  const config = S3DocumentConfig.parse(raw);
  const tags = await ports.tags();
  if (
    tags.Application !== 'Rove' ||
    tags.Environment !== 'staging' ||
    tags.DataClassification !== 'PrivateDriverDocuments'
  )
    throw new Error('Refusing writes: expected a tagged Rove staging document bucket.');
  const bytes = new TextEncoder().encode(
    '%PDF-1.7\n% Rove synthetic storage verification. No identity data.\n%%EOF\n',
  );
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const reservation = {
    id: randomUUID(),
    kind: 'driver_license' as const,
    contentType: 'application/pdf' as const,
    bytes: bytes.length,
    sha256,
  };
  const target = DriverDocumentUploadTarget.parse(
    await ports.issue({ ...reservation, expiresAt: new Date(Date.now() + 120_000).toISOString() }),
  );
  const expectedUrl = `https://${config.bucket}.s3.${config.region}.amazonaws.com/`;
  const prefix = `driver-documents/inbox/${reservation.id}/`;
  if (
    target.url !== expectedUrl ||
    target.documentId !== reservation.id ||
    !target.key.startsWith(prefix) ||
    !z.uuid().safeParse(target.key.slice(prefix.length)).success ||
    target.fields.key !== target.key
  )
    throw new Error('Refusing an unexpected upload destination.');
  const form = new FormData();
  for (const [key, value] of Object.entries(target.fields)) form.append(key, value);
  form.append('file', new Blob([bytes], { type: reservation.contentType }), 'synthetic.pdf');
  const response = await ports.fetch(target.url, {
    method: 'POST',
    body: form,
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  // Do not log a signed form or raw provider error body.
  await response.body?.cancel();
  if (response.status !== 201) throw new Error('The synthetic inbox transfer was not accepted.');
  const downloaded = await ports.read({ ...reservation, key: target.key });
  if (createHash('sha256').update(downloaded).digest('hex') !== sha256)
    throw new Error('The inbox round trip changed the synthetic bytes.');
  const receipt = await quarantineDriverDocument(
    {
      driverId: randomUUID(),
      documentId: reservation.id,
      kind: reservation.kind,
      contentType: reservation.contentType,
      expectedSha256: sha256,
    },
    downloaded,
    ports.quarantine,
  );
  // Verify both objects deny anonymous access. The uploader identity needs no quarantine read permission.
  for (const key of [target.key, receipt.key]) {
    const anonymous = await ports.fetch(expectedUrl + key, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    await anonymous.body?.cancel();
    if (anonymous.status !== 403) throw new Error('Anonymous access was not explicitly denied.');
  }
  await ports.verifyUploaderRestrictions?.({ key: receipt.key, version: receipt.version });
  return {
    ...(ports.verifyUploaderRestrictions ? { uploaderRestrictions: 'verified' as const } : {}),
    status: 'verified' as const,
    documentId: reservation.id,
    bytes: bytes.length,
    quarantineVersion: receipt.version,
  };
}
