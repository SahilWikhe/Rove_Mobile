import { ConfigurationError } from './config';
/** LISTEN requires a direct session on the same database/role as the HTTP runtime. */
export function realtimeDatabaseUrl(env: Record<string, string | undefined>) {
  if (env.REALTIME_DATABASE_URL === undefined) return undefined;
  try {
    const direct = new URL(env.REALTIME_DATABASE_URL);
    const main = new URL(env.DATABASE_URL ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(direct.protocol) ||
      Boolean(direct.hash) ||
      direct.hostname.includes('-pooler.') ||
      direct.hostname !== main.hostname.replace('-pooler.', '.') ||
      direct.pathname !== main.pathname ||
      direct.username !== main.username ||
      direct.password !== main.password ||
      direct.port !== main.port ||
      direct.search !== main.search ||
      direct.searchParams.get('sslmode') !== 'verify-full'
    )
      throw new Error();
    return direct.toString();
  } catch {
    throw new ConfigurationError(['realtime.databaseUrl']);
  }
}
