import { DomainError } from './errors';

/** Internal storage-port evidence: throw only before invoking any object-write operation. */
export class DocumentWriteNotDispatched extends DomainError {
  constructor() {
    super(
      'DOCUMENT_STORAGE_UNAVAILABLE',
      'Private document storage could not be verified. Check upload status before retrying.',
      503,
    );
  }
}
