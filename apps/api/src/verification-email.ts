import { z } from 'zod';
import { DomainError } from '@rove/server';
import { ConfigurationError } from './config';

const Config = z.object({
  issuer: z.string().regex(/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.auth0\.com\/$/),
  clientId: z.string().trim().min(1).max(256),
  clientSecret: z.string().min(1).max(4096),
});
export type VerificationEmailConfig = z.infer<typeof Config>;

/** Optional server-only credentials. Never infer a different tenant from user input. */
export function readVerificationEmailConfig(env: Record<string, string | undefined>) {
  const clientId = env.AUTH0_VERIFICATION_CLIENT_ID;
  const clientSecret = env.AUTH0_VERIFICATION_CLIENT_SECRET;
  if (clientId === undefined && clientSecret === undefined) return undefined;
  const result = Config.safeParse({ issuer: env.OIDC_ISSUER, clientId, clientSecret });
  if (!result.success) throw new ConfigurationError(['verificationEmail']);
  return result.data;
}

const Token = z.object({
  access_token: z.string().min(1).max(16384),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive().max(2_592_000),
});
const Job = z.object({
  id: z.string().startsWith('job_'),
  type: z.literal('verification_email'),
  status: z.enum(['pending', 'completed']),
});
const unavailable = () =>
  new DomainError(
    'VERIFICATION_EMAIL_UNAVAILABLE',
    'We could not confirm the email request. Check your inbox before trying again later.',
    503,
  );

/** Request acceptance is not inbox delivery. This adapter never retries an email job. */
export class Auth0VerificationEmail {
  private readonly config: VerificationEmailConfig;
  private cached: { value: string; until: number } | undefined;
  private pending: Promise<string> | undefined;
  constructor(
    config: VerificationEmailConfig,
    private readonly transport: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    const parsed = Config.safeParse(config);
    if (!parsed.success) throw new ConfigurationError(['verificationEmail']);
    this.config = parsed.data;
  }
  private async token(): Promise<string> {
    if (this.cached && this.cached.until > this.now()) return this.cached.value;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await this.transport(this.config.issuer + 'oauth/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          audience: this.config.issuer + 'api/v2/',
          scope: 'update:users',
        }),
      });
      if (!response.ok) throw unavailable();
      const token = Token.parse(await response.json());
      this.cached = {
        value: token.access_token,
        until: this.now() + Math.max(0, token.expires_in - 60) * 1000,
      };
      return token.access_token;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  async request(subject: string): Promise<void> {
    const prefix = this.config.issuer + '|';
    const userId = subject.startsWith(prefix) ? subject.slice(prefix.length) : '';
    // Rove database accounts own email verification; external identity providers own theirs.
    if (!/^auth0\|[^\s|]{1,200}$/.test(userId))
      throw new DomainError(
        'VERIFICATION_EMAIL_UNSUPPORTED',
        'Verify this email with your sign-in provider, then sign in again.',
        409,
      );
    try {
      const token = await this.token();
      const response = await this.transport(this.config.issuer + 'api/v2/jobs/verification-email', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ user_id: userId }),
      });
      if (response.status === 401 && this.cached?.value === token) this.cached = undefined;
      if (response.status !== 201) throw unavailable();
      Job.parse(await response.json());
    } catch {
      throw unavailable();
    }
  }
}
