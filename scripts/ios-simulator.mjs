import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Configure only the installed simulator app. Never alter generated native source or release URLs.
const [role, port, device = 'booted'] = process.argv.slice(2);
if (!['rider', 'driver'].includes(role) || !/^\d{1,5}$/.test(port ?? '') || +port < 1 || +port > 65535) {
  console.error('Usage: node scripts/ios-simulator.mjs rider|driver METRO_PORT [SIMULATOR_UDID]');
  process.exit(1);
}
const host = `127.0.0.1:${port}`;
try {
  const status = await fetch(`http://${host}/status`, { signal: AbortSignal.timeout(5000) });
  if (!status.ok || (await status.text()).trim() !== 'packager-status:running')
    throw new Error('Metro is not ready.');
} catch {
  console.error(`Start the intended app's Metro server on ${host} before opening the simulator.`);
  process.exit(1);
}
const app = `co.roveride.${role}`;
const simctl = (...args) =>
  execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  const container = simctl('get_app_container', device, app, 'data');
  // An already stopped app is expected; launching below still reports real simulator failures.
  try {
    simctl('terminate', device, app);
  } catch {
    // A stopped app does not need termination.
  }
  simctl(
    'spawn',
    device,
    'defaults',
    'write',
    join(container, 'Library', 'Preferences', `${app}.plist`),
    'RCT_jsLocation',
    '-string',
    host,
  );
  simctl('launch', device, app);
  console.log(`Opened ${role} with Metro at ${host}. Keep that server running when restarting the app.`);
} catch {
  console.error('Could not configure the simulator. Boot the chosen device and install the app first.');
  process.exitCode = 1;
}
