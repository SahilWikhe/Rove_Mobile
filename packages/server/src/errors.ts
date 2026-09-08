export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503 = 409) {
    super(message); this.name = 'DomainError';
  }
}
