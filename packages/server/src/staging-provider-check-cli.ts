import Stripe from 'stripe';
import { GoogleMapsProvider } from './google-maps';
import { inspectMapsStaging } from './maps-staging-readiness';
import { inspectStripeStaging } from './stripe-staging-readiness';
import { z } from 'zod';

// Fixed public staging endpoints. Never accept a runner-supplied production URL.
const issuer = 'https://dev-1x3fgtb2cj2nfbj1.us.auth0.com/';
let stage = 'configuration';
async function read(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error('Provider unavailable');
  return response.json();
}
try {
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== '--allow-billable-requests' ||
    process.env.ROVE_ENVIRONMENT !== 'staging'
  )
    throw new Error('Explicit staging opt-in required');
  // Check sandbox selection before making any billable Maps requests.
  stage = 'Stripe sandbox account and payment configuration';
  await inspectStripeStaging(process.env, (key) => {
    const stripe = new Stripe(key, { apiVersion: '2026-08-26.dahlia', timeout: 10000, maxNetworkRetries: 0 });
    return {
      account: () => stripe.accounts.retrieve(null),
      configuration: (id) => stripe.paymentMethodConfigurations.retrieve(id),
    };
  });
  console.log('Stripe sandbox configuration passed (read-only).');
  stage = 'deployed staging API';
  z.object({ status: z.literal('ok') }).parse(await read('https://rove-api-staging.vercel.app/health/live'));
  console.log('Deployed staging API availability passed.');
  stage = 'Auth0 discovery and signing keys';
  z.object({
    issuer: z.literal(issuer),
    jwks_uri: z.literal(issuer + '.well-known/jwks.json'),
    authorization_endpoint: z.literal(issuer + 'authorize'),
    token_endpoint: z.literal(issuer + 'oauth/token'),
    code_challenge_methods_supported: z.array(z.string()).refine((values) => values.includes('S256')),
  }).parse(await read(issuer + '.well-known/openid-configuration'));
  z.object({
    keys: z
      .array(
        z.object({
          kty: z.string(),
          use: z.string().optional(),
          alg: z.string().optional(),
          kid: z.string().optional(),
          n: z.string().optional(),
          e: z.string().optional(),
        }),
      )
      .refine((keys) =>
        keys.some(
          (key) => key.kty === 'RSA' && key.use === 'sig' && key.alg === 'RS256' && key.kid && key.n && key.e,
        ),
      ),
  }).parse(await read(issuer + '.well-known/jwks.json'));
  console.log('Auth0 discovery and RSA signing keys passed.');
  stage = 'Google Places and Routes';
  await inspectMapsStaging(
    process.env,
    {
      pickup: 'Raleigh Union Station, Raleigh NC',
      destination: 'North Carolina Museum of Natural Sciences, Raleigh NC',
    },
    (key, area) => new GoogleMapsProvider(key, area),
    true,
  );
  console.log('Google address search, details and driving route passed (up to five requests).');
  console.log('Provider checks only: no login, ride, charge or database mutation was performed.');
} catch {
  // Never emit provider bodies, SDK errors, tokens or environment values into CI logs.
  console.error(`Staging provider check failed at ${stage}.`);
  process.exitCode = 1;
}
