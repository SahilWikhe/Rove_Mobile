import { nativeSmokeCommand } from './native-smoke-command.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [role, artifact, ...rest] = process.argv.slice(2);
if (!['rider', 'driver'].includes(role) || !artifact || rest.length) {
  console.error('Usage: node scripts/ios-release-smoke.mjs rider|driver /path/to/Release.app');
  process.exit(1);
}
const app = resolve(artifact),
  bundle = `co.roveride.${role}`;
const command = (name, args, timeout = 60000) =>
  execFileSync(name, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  }).trim();
const simctl = (...args) => command('xcrun', ['simctl', ...args], 180000);
let device;
try {
  if (!existsSync(`${app}/main.jsbundle`)) throw new Error('Standalone JavaScript bundle is missing.');
  if (command('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', `${app}/Info.plist`]) !== bundle)
    throw new Error('Artifact does not match the requested app.');
  const { runtimes } = JSON.parse(simctl('list', 'runtimes', '--json'));
  const runtime = runtimes
    .filter((r) => r.isAvailable && r.identifier.includes('.iOS-'))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (!runtime) throw new Error('No available iOS simulator runtime.');
  device = simctl(
    'create',
    `Rove release smoke ${role} ${process.pid}`,
    'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
    runtime.identifier,
  );
  simctl('boot', device);
  simctl('bootstatus', device, '-b');
  simctl('install', device, app);
  mkdirSync('reports/native-smoke', { recursive: true });
  console.log(`${role}: simulator booted and release installed; starting Maestro.`);
  nativeSmokeCommand(
    process.env.MAESTRO_BINARY || 'maestro',
    [
      '--device',
      device,
      'test',
      '-e',
      `APP_ID=${bundle}`,
      '--format',
      'junit',
      '--output',
      `reports/native-smoke/${role}.xml`,
      '--test-output-dir',
      `reports/native-smoke/ios-${role}-details`,
      '--debug-output',
      `reports/native-smoke/ios-${role}-debug`,
      'native-tests/release-welcome.yaml',
    ],
    `reports/native-smoke/ios-${role}-maestro.log`,
    180000,
  );
  simctl('io', device, 'screenshot', `reports/native-smoke/${role}.png`);
  console.log(`${role}: standalone welcome and account-entry control verified on a fresh iOS simulator.`);
} catch (error) {
  console.error('iOS release smoke failed:', error.message);
  if (device) {
    try {
      mkdirSync('reports/native-smoke', { recursive: true });
      simctl('io', device, 'screenshot', `reports/native-smoke/ios-${role}-failure.png`);
    } catch {
      console.error('Failure screenshot could not be captured.');
    }
  }
  process.exitCode = 1;
} finally {
  if (device) {
    try {
      simctl('shutdown', device);
    } catch {
      /* The test may already have stopped it. */
    }
    try {
      simctl('delete', device);
    } catch {
      console.error(`Could not remove smoke simulator ${device}.`);
      process.exitCode = 1;
    }
  }
}
