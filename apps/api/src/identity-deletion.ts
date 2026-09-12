import { z } from 'zod';
import { DomainError } from '@rove/server';
import { ConfigurationError } from './config';

const Config = z.object({
  issuer: z.string().regex(/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.auth0\.com\/$/),
  clientId: z.string().trim().min(1).max(256),
  clientSecret: z.string().min(1).max(4096),
});
export type IdentityDeletionConfig = z.infer<typeof Config>;

/** Dedicated server credentials; supplying them alone does not activate deletion. */
export function readIdentityDeletionConfig(env: Record<string, string | undefined>) {
  const clientId = env.AUTH0_DELETION_CLIENT_ID;
  const clientSecret = env.AUTH0_DELETION_CLIENT_SECRET;
  if (clientId === undefined && clientSecret === undefined) return undefined;
  const parsed = Config.safeParse({ issuer: env.OIDC_ISSUER, clientId, clientSecret });
  if (!parsed.success) throw new ConfigurationError(['identityDeletion']);
  return parsed.data;
}

const Token = z.object({
  access_token: z.string().min(1).max(16384),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive().max(2_592_000),
  scope: z.string().optional(),
});
const Missing = z.object({ statusCode: z.literal(404), error: z.literal('Not Found') });
const unavailable = () =>
  new DomainError(
    'IDENTITY_DELETION_UNAVAILABLE',
    'Identity deletion could not be verified. Retry later.',
    503,
  );

/**
 * Provider step only: the durable caller must already authorize deletion, disable
 * local access and retain a subject revocation record before invoking this class.
 * Auth0 absence is not proof of application, storage or backup data erasure.
 */
export class Auth0IdentityDeletion {
  private readonly config: IdentityDeletionConfig;
  private cached: { value: string; until: number } | undefined;
  private pending: Promise<string> | undefined;
  constructor(
    config: IdentityDeletionConfig,
    private readonly transport: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    const parsed = Config.safeParse(config);
    if (!parsed.success) throw new ConfigurationError(['identityDeletion']);
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
          scope: 'read:users delete:users',
        }),
      });
      if (!response.ok) throw unavailable();
      const token = Token.parse(await response.json());
      if (
        token.scope !== undefined &&
        !['read:users', 'delete:users'].every((scope) => token.scope!.split(' ').includes(scope))
      )
        throw unavailable();
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
  private async request(path: string, method: 'GET' | 'DELETE', token: string) {
    const response = await this.transport(this.config.issuer + path, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    });
    if (response.status === 401 && this.cached?.value === token) this.cached = undefined;
    return response;
  }
  private async present(path: string, userId: string, token: string) {
    const response = await this.request(path + '?fields=user_id&include_fields=true', 'GET', token);
    if (response.status === 404) {
      Missing.parse(await response.json());
      return false;
    }
    if (response.status !== 200) throw unavailable();
    const user = z.object({ user_id: z.literal(userId) }).parse(await response.json());
    return !!user;
  }
  async erase(subject: string): Promise<{ status: 'absent' }> {
    const prefix = this.config.issuer + '|';
    const userId = subject.startsWith(prefix) ? subject.slice(prefix.length) : '';
    // Tenant-qualified database subject, not email lookup or a client-supplied URL.
    // Includes social identities; removal affects their Auth0 profile, not the external provider account.
    if (userId.length > 300 || !/^[a-zA-Z0-9_-]+\|[^\s|\p{Cc}]{1,280}$/u.test(userId))
      throw new DomainError(
        'IDENTITY_DELETION_SUBJECT_INVALID',
        'Identity does not belong to this tenant.',
        409,
      );
    try {
      const token = await this.token();
      const path = 'api/v2/users/' + encodeURIComponent(userId);
      if (!(await this.present(path, userId, token))) return { status: 'absent' };
      const response = await this.request(path, 'DELETE', token);
      // Even a successful DELETE needs a direct absence check. A lost response is
      // retried by the durable caller, whose next GET recovers an already deleted identity.
      if (response.status !== 204) throw unavailable();
      if (await this.present(path, userId, token)) throw unavailable();
      return { status: 'absent' };
    } catch {
      throw unavailable();
    }
  }
}
