import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectAuth0, staging } from './auth0-staging-check.mjs';
function fixture() {
  const issuer = `https://${staging.tenant}/`;
  return {
    api: {
      identifier: staging.audience,
      signing_alg: 'RS256',
      token_lifetime: 900,
      allow_offline_access: true,
    },
    clients: Object.fromEntries(
      Object.entries(staging.clients).map(([role, id]) => [
        role,
        {
          client_id: id,
          app_type: 'native',
          token_endpoint_auth_method: 'none',
          oidc_conformant: true,
          is_first_party: true,
          grant_types: ['refresh_token', 'authorization_code'],
          callbacks: [`rove-${role}://auth/callback`],
          allowed_logout_urls: [`rove-${role}://auth/callback`],
          refresh_token: {
            rotation_type: 'rotating',
            expiration_type: 'expiring',
            infinite_token_lifetime: false,
            infinite_idle_token_lifetime: false,
            token_lifetime: 2592000,
            idle_token_lifetime: 604800,
            leeway: 3,
          },
        },
      ]),
    ),
    connectionClients: Object.values(staging.clients).map((client_id) => ({ client_id })),
    discovery: {
      issuer,
      jwks_uri: `${issuer}.well-known/jwks.json`,
      authorization_endpoint: `${issuer}authorize`,
      token_endpoint: `${issuer}oauth/token`,
      code_challenge_methods_supported: ['S256'],
    },
    jwks: { keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256', kid: 'test', n: 'test-modulus', e: 'AQAB' }] },
  };
}
test('accepts intended configuration regardless of grant order or unrelated connection clients', () => {
  const value = fixture();
  value.connectionClients.push({ client_id: 'existing-app' });
  assert.deepEqual(inspectAuth0(value), []);
});
for (const [name, mutate, expected] of [
  [
    'wrong audience',
    (v) => {
      v.api.identifier = 'production';
    },
    'API policy',
  ],
  [
    'implicit flow enabled',
    (v) => {
      v.clients.rider.grant_types.push('implicit');
    },
    'rider client',
  ],
  [
    'wildcard callback',
    (v) => {
      v.clients.driver.callbacks.push('https://*.example.com');
    },
    'driver client',
  ],
  [
    'secret required by public client',
    (v) => {
      v.clients.rider.token_endpoint_auth_method = 'client_secret_post';
    },
    'rider client',
  ],
  [
    'refresh rotation disabled',
    (v) => {
      v.clients.driver.refresh_token.rotation_type = 'non-rotating';
    },
    'driver refresh policy',
  ],
  [
    'infinite refresh lifetime',
    (v) => {
      v.clients.rider.refresh_token.infinite_token_lifetime = true;
    },
    'rider refresh policy',
  ],
  [
    'missing connection membership',
    (v) => {
      v.connectionClients = [];
    },
    'rider connection',
  ],
  [
    'foreign discovery endpoint',
    (v) => {
      v.discovery.token_endpoint = 'https://foreign.example/token';
    },
    'OIDC discovery',
  ],
  [
    'missing PKCE support',
    (v) => {
      v.discovery.code_challenge_methods_supported = ['plain'];
    },
    'OIDC discovery',
  ],
  [
    'no signing keys',
    (v) => {
      v.jwks.keys = [];
    },
    'RSA signing keys',
  ],
])
  test(`detects ${name}`, () => {
    const value = fixture();
    mutate(value);
    assert.ok(inspectAuth0(value).includes(expected));
  });
