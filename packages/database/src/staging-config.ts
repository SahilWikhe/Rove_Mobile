/** Operations-only configuration. Never accept ambient production or an unconfirmed endpoint. */
export function stagingUrl(env: NodeJS.ProcessEnv, pooled: boolean): string {
  const fail = () => new Error('Staging requires a confirmed Neon endpoint and verify-full credentials.');
  if (env.ROVE_ENVIRONMENT !== 'staging' || env.VERCEL || env.NODE_ENV === 'production') throw fail();
  const host = env.NEON_STAGING_HOST;
  if (!host || !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(host) || host.includes('-pooler.'))
    throw fail();
  let url: URL;
  try {
    url = new URL((pooled ? env.DATABASE_URL : env.DATABASE_URL_UNPOOLED) ?? '');
  } catch {
    throw fail();
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== (pooled ? host.replace('.', '-pooler.') : host) ||
    !url.username ||
    !url.password ||
    url.pathname !== '/neondb' ||
    url.hash ||
    url.port ||
    url.search !== '?sslmode=verify-full'
  )
    throw fail();
  return url.toString();
}
