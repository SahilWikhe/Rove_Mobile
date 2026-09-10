import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Public staging identifiers only. Never use ambient tenant selection or request client secrets.
export const staging = {
  tenant: 'dev-1x3fgtb2cj2nfbj1.us.auth0.com',
  audience: 'https://api.staging.roveride.co',
  apiId: '6aa251cb0da48534342814a9',
  connectionId: 'con_mks0HnzsRcAsi5bU',
  clients: {
    rider: 'TEp7gmPu56D1JUC92H0K0gmhRBfFiewe',
    driver: 'uz2y8UTB4WajTN5VhNCgQVEJkvIZxqju',
  },
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function inspectAuth0({ api, clients, connectionClients, discovery, jwks }) {
  const failures = [];
  const issuer = `https://${staging.tenant}/`;
  if (
    api.identifier !== staging.audience ||
    api.signing_alg !== 'RS256' ||
    api.token_lifetime !== 900 ||
    api.allow_offline_access !== true
  )
    failures.push('API policy');
  for (const [role, id] of Object.entries(staging.clients)) {
    const c = clients[role];
    const rt = c?.refresh_token;
    if (
      !c ||
      c.client_id !== id ||
      c.app_type !== 'native' ||
      c.token_endpoint_auth_method !== 'none' ||
      c.oidc_conformant !== true ||
      c.is_first_party !== true ||
      !equal([...(c.grant_types ?? [])].sort(), ['authorization_code', 'refresh_token']) ||
      !equal(c.callbacks, [`rove-${role}://auth/callback`]) ||
      !equal(c.allowed_logout_urls, [`rove-${role}://auth/callback`])
    )
      failures.push(`${role} client`);
    if (
      !rt ||
      rt.rotation_type !== 'rotating' ||
      rt.expiration_type !== 'expiring' ||
      rt.infinite_token_lifetime !== false ||
      rt.infinite_idle_token_lifetime !== false ||
      rt.token_lifetime !== 2592000 ||
      rt.idle_token_lifetime !== 604800 ||
      rt.leeway !== 3
    )
      failures.push(`${role} refresh policy`);
    if (!connectionClients.some((client) => client.client_id === id)) failures.push(`${role} connection`);
  }
  if (
    discovery.issuer !== issuer ||
    discovery.jwks_uri !== `${issuer}.well-known/jwks.json` ||
    discovery.authorization_endpoint !== `${issuer}authorize` ||
    discovery.token_endpoint !== `${issuer}oauth/token` ||
    !discovery.code_challenge_methods_supported?.includes('S256')
  )
    failures.push('OIDC discovery');
  if (
    !jwks.keys?.some(
      (key) =>
        key.kty === 'RSA' &&
        key.use === 'sig' &&
        key.alg === 'RS256' &&
        typeof key.kid === 'string' &&
        key.kid.length > 0 &&
        key.n &&
        key.e,
    )
  )
    failures.push('RSA signing keys');
  return failures;
}
function read(path) {
  return JSON.parse(
    execFileSync('auth0', ['api', 'get', path, '--tenant', staging.tenant], {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 2_000_000,
    }),
  );
}
async function publicJson(path) {
  const response = await fetch(`https://${staging.tenant}/${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Public endpoint unavailable');
  return response.json();
}
export async function run() {
  try {
    const api = read(`resource-servers/${staging.apiId}`);
    const fields =
      'client_id,app_type,token_endpoint_auth_method,oidc_conformant,is_first_party,grant_types,callbacks,allowed_logout_urls,refresh_token';
    const clients = Object.fromEntries(
      Object.entries(staging.clients).map(([role, id]) => [
        role,
        read(`clients/${id}?fields=${fields}&include_fields=true`),
      ]),
    );
    const connectionClients = [];
    let cursor;
    const seen = new Set();
    do {
      const page = read(
        `connections/${staging.connectionId}/clients?take=100${cursor ? `&from=${encodeURIComponent(cursor)}` : ''}`,
      );
      connectionClients.push(...page.clients);
      cursor = page.next;
      if (cursor && seen.has(cursor)) throw new Error('Repeated cursor');
      seen.add(cursor);
    } while (cursor);
    // Fetch only pinned endpoints, never an arbitrary URL returned by discovery.
    const [discovery, jwks] = await Promise.all([
      publicJson('.well-known/openid-configuration'),
      publicJson('.well-known/jwks.json'),
    ]);
    const failures = inspectAuth0({ api, clients, connectionClients, discovery, jwks });
    if (failures.length) {
      console.error(`Auth0 staging drift: ${failures.join(', ')}`);
      return 1;
    }
    console.log('Auth0 staging configuration passed. Read-only; no users or tokens created.');
    console.log('Native login, callback, refresh/revocation and MFA still require end-to-end verification.');
    return 0;
  } catch {
    // CLI errors may embed credentials or provider details. Never emit captured output.
    console.error(
      'Auth0 staging check could not complete. Check CLI login, read permissions and network access.',
    );
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await run();
