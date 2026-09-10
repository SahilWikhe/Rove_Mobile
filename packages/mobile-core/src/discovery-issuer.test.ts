import { expect, test } from 'vitest';
import { discoveryIssuer } from './discovery-issuer';
test.each([
  ['https://tenant.auth0.com/', 'https://tenant.auth0.com'],
  ['https://tenant.auth0.com', 'https://tenant.auth0.com'],
  ['https://identity.example/realm/', 'https://identity.example/realm'],
])('Expo discovery appends one separator to %s', (issuer, base) => {
  expect(discoveryIssuer(issuer)).toBe(base);
  expect(`${discoveryIssuer(issuer)}/.well-known/openid-configuration`).toBe(
    `${base}/.well-known/openid-configuration`,
  );
});
