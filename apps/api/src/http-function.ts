import app from '../index';

// Vercel supplies a Web Request, preserving raw bytes for webhook verification.
export default { fetch: app.fetch };
