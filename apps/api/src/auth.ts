import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { DomainError } from '@rove/server';

export const VERIFIED_EMAIL_CLAIM = 'https://roveride.co/email_verified';

export type VerifyIdentity = (token: string) => Promise<{ subject: string; mfa?: boolean }>;
export function oidcIdentity(
  config: { issuer: string; audience: string; jwksUrl: string; requireVerifiedEmail?: boolean },
  testKeys?: JWTVerifyGetKey,
): VerifyIdentity {
  if (![config.issuer, config.jwksUrl].every((value) => new URL(value).protocol === 'https:'))
    throw new Error('Identity provider URLs must use HTTPS.');
  if (!config.audience) throw new Error('An API audience is required.');
  const keys =
    testKeys ??
    createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 5000, cooldownDuration: 30_000 });
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      });
      if (!payload.sub || payload.sub.length > 300) throw new Error('Invalid subject');
      if (config.requireVerifiedEmail && payload[VERIFIED_EMAIL_CLAIM] !== true)
        throw new DomainError('EMAIL_VERIFICATION_REQUIRED', 'Verify your email, then sign in again.', 403);
      return {
        subject: `${config.issuer}|${payload.sub}`,
        // Trust only the configured issuer's signed MFA evidence, never request headers.
        mfa:
          Array.isArray(payload.amr) &&
          payload.amr.every((method) => typeof method === 'string') &&
          payload.amr.includes('mfa'),
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('UNAUTHENTICATED', 'Please sign in again.', 401);
    }
  };
}
