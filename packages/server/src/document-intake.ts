import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from './errors';

export const MAX_DRIVER_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DriverDocumentKind = z.enum(['driver_license', 'vehicle_registration', 'vehicle_insurance']);
export const DriverDocumentMime = z.enum(['image/jpeg', 'image/png', 'application/pdf']);
const Intake = z
  .object({
    driverId: z.uuid(),
    documentId: z.uuid(),
    kind: DriverDocumentKind,
    contentType: DriverDocumentMime,
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** Private, write-once quarantine objects. Implementations must not return a public URL. */
export interface DocumentQuarantineStore {
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: z.infer<typeof DriverDocumentMime>;
    sha256: string;
    ifAbsent: true;
  }): Promise<{ version: string; sha256: string; bytes: number }>;
}

function matchesSignature(bytes: Uint8Array, contentType: z.infer<typeof DriverDocumentMime>) {
  const starts = (prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (contentType === 'image/png') return starts([137, 80, 78, 71, 13, 10, 26, 10]);
  if (contentType === 'image/jpeg') return starts([255, 216, 255]);
  return starts([37, 80, 68, 70, 45]); // %PDF-
}

/**
 * Call only after ownership/eligibility checks and a durable upload reservation.
 * Signature validation is not malware scanning or document verification.
 * Every result remains quarantined; only a scanner and authorized reviewer can advance it.
 */
export async function quarantineDriverDocument(
  raw: unknown,
  bytes: Uint8Array,
  store: DocumentQuarantineStore,
) {
  const parsed = Intake.safeParse(raw);
  if (!parsed.success) throw new DomainError('INVALID_DOCUMENT', 'Check the document upload details.', 422);
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_DRIVER_DOCUMENT_BYTES
  )
    throw new DomainError('INVALID_DOCUMENT_SIZE', 'Upload a document between 1 byte and 10 MB.', 422);
  const input = parsed.data;
  if (!matchesSignature(bytes, input.contentType))
    throw new DomainError(
      'INVALID_DOCUMENT_TYPE',
      'Choose a JPEG, PNG or PDF matching the selected file type.',
      422,
    );
  // Snapshot caller-owned memory before hashing and asynchronous storage work.
  const body = Uint8Array.from(bytes);
  const sha256 = createHash('sha256').update(body).digest('hex');
  if (sha256 !== input.expectedSha256)
    throw new DomainError(
      'DOCUMENT_CHECKSUM_MISMATCH',
      'The file changed. Select it again before uploading.',
      422,
    );
  // No driver identifiers or user filenames in storage paths. Each attempt is immutable.
  const key = `driver-documents/quarantine/${input.documentId}/${randomUUID()}`;
  try {
    const stored = await store.put({ key, body, contentType: input.contentType, sha256, ifAbsent: true });
    const receipt = z
      .object({
        version: z.string().min(1).max(1024),
        sha256: z.literal(sha256),
        bytes: z.literal(body.byteLength),
      })
      .parse(stored);
    return {
      documentId: input.documentId,
      driverId: input.driverId,
      kind: input.kind,
      key,
      version: receipt.version,
      sha256,
      bytes: receipt.bytes,
      contentType: input.contentType,
      state: 'quarantined' as const,
    };
  } catch {
    // Never expose storage URLs, credentials, filenames or raw provider errors to a driver.
    throw new DomainError(
      'DOCUMENT_STORAGE_UNAVAILABLE',
      'The document could not be stored. Check upload status before retrying.',
      503,
    );
  }
}
