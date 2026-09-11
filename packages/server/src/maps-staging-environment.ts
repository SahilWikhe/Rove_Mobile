import { parseEnv } from 'node:util';

/** Vercel env pull wraps JSON in double quotes without escaping its inner quotes. */
export function parseMapsStagingEnvironment(source: string) {
  const env = parseEnv(source);
  const lines = source.split(/\r?\n/).filter((line) => /^\s*(?:export\s+)?SERVICE_AREA_JSON\s*=/.test(line));
  if (lines.length === 1) {
    const raw = lines[0]!.slice(lines[0]!.indexOf('=') + 1).trim();
    if (raw.startsWith('"{') && raw.endsWith('}"')) {
      const json = raw.slice(1, -1);
      try {
        JSON.parse(json);
        env.SERVICE_AREA_JSON = json;
      } catch {
        // Leave invalid configuration for the readiness validator to reject safely.
      }
    }
  } else if (lines.length > 1) {
    // Avoid silently choosing between conflicting service-area definitions.
    delete env.SERVICE_AREA_JSON;
  }
  return env;
}
