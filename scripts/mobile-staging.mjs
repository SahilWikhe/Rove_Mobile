import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Public native-client identifiers; API/database/payment secrets never belong here.
const clients = {
  rider: { clientId: 'TEp7gmPu56D1JUC92H0K0gmhRBfFiewe', port: '8087' },
  driver: { clientId: 'uz2y8UTB4WajTN5VhNCgQVEJkvIZxqju', port: '8088' },
};
export function stagingLaunch(role, inherited = process.env) {
  if (!Object.hasOwn(clients, role)) throw new Error('Choose rider or driver.');
  const key = inherited.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (key && !/^pk_test_[a-zA-Z0-9]+$/.test(key))
    throw new Error('Staging requires a Stripe test publishable key.');
  const client = clients[role];
  return {
    args: ['--filter', `@rove/${role}`, 'exec', 'expo', 'start', '--port', client.port],
    env: {
      ...inherited,
      EXPO_PUBLIC_API_URL: 'https://rove-api-staging.vercel.app',
      EXPO_PUBLIC_AUTH_ISSUER: 'https://dev-1x3fgtb2cj2nfbj1.us.auth0.com',
      EXPO_PUBLIC_AUTH_AUDIENCE: 'https://api.staging.roveride.co',
      EXPO_PUBLIC_AUTH_CLIENT_ID: client.clientId,
      EXPO_PUBLIC_SYNTHETIC: 'false',
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const launch = stagingLaunch(process.argv[2]);
  console.log(`Starting ${process.argv[2]} against Rove staging with Auth0 sign-in.`);
  const child = spawn('pnpm', launch.args, {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: launch.env,
    stdio: 'inherit',
  });
  child.once('error', () => {
    console.error('Unable to start Expo. Ensure pnpm is installed.');
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}
