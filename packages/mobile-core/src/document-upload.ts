import { z } from 'zod';
import { DriverDocumentReservation, DriverDocumentUploadTarget } from '@rove/contracts';
import { ApiError, type Transport } from './index';
/** Storage transport deliberately has no access to the API token provider. File stays in memory. */
export async function sendDriverDocument(
  rawTarget: unknown,
  rawReservation: unknown,
  file: Blob,
  signal?: AbortSignal,
  transport: Transport = (url, options) => fetch(url, options),
) {
  const target = DriverDocumentUploadTarget.parse(rawTarget);
  const reservation = DriverDocumentReservation.parse(rawReservation);
  const url = new URL(target.url);
  const prefix = `driver-documents/inbox/${reservation.id}/`;
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !/^[a-z0-9][a-z0-9-]+[a-z0-9]\.s3\.[a-z]{2}-[a-z]+-\d\.amazonaws\.com$/.test(url.hostname) ||
    target.documentId !== reservation.id ||
    !target.key.startsWith(prefix) ||
    !z.uuid().safeParse(target.key.slice(prefix.length)).success ||
    target.fields.key !== target.key
  )
    throw new ApiError('INVALID_UPLOAD_TARGET', 'The secure upload could not be prepared. Try again.', 422);
  if (Date.parse(target.expiresAt) <= Date.now())
    throw new ApiError('UPLOAD_EXPIRED', 'The upload link expired. Try again.', 409);
  if (file.size !== reservation.bytes || file.type !== reservation.contentType)
    throw new ApiError('INVALID_DOCUMENT', 'The selected file changed. Select it again.', 422);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 60_000);
  try {
    if (signal?.aborted) throw new Error('Upload cancelled');
    const form = new FormData();
    for (const [name, value] of Object.entries(target.fields)) form.append(name, value);
    // S3 requires the file part last. Avoid sending personal filenames to storage.
    form.append('file', file, 'document');
    const response = await transport(target.url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Storage rejected upload');
    // Storage success is not approval. Caller must complete verification through the API.
  } catch {
    throw new ApiError(
      'DOCUMENT_TRANSFER_FAILED',
      'The file transfer did not finish. Check upload status before retrying.',
      0,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
