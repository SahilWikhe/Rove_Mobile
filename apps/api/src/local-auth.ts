/** Local-only identity selection. Never imported by a deployed entrypoint. */
export function localAuthConfig(env: Record<string, string | undefined>) {
  if (env.NODE_ENV === 'production' || env.VERCEL !== undefined)
    throw new Error('Local authentication is forbidden in deployments.');
  if (!env.ROVE_LOCAL_AUTH) return undefined;
  if (env.ROVE_LOCAL_AUTH !== 'auth0' || env.ROVE_E2E === '1')
    throw new Error('Unsupported local authentication mode.');
  // Pin the development tenant: a local fixture server must never accept production identities.
  return {
    issuer: 'https://dev-1x3fgtb2cj2nfbj1.us.auth0.com/',
    audience: 'https://api.staging.roveride.co',
    jwksUrl: 'https://dev-1x3fgtb2cj2nfbj1.us.auth0.com/.well-known/jwks.json',
  };
}
