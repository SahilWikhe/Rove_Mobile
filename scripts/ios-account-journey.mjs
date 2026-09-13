import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { nativeSmokeCommand } from './native-smoke-command.mjs';

const [role, artifact, port, ...rest] = process.argv.slice(2);
if (
  !['rider', 'driver'].includes(role) ||
  !artifact ||
  !/^\d+$/.test(port ?? '') ||
  Number(port) < 1024 ||
  Number(port) > 65535 ||
  rest.length
) {
  console.error(
    'Usage: node scripts/ios-account-journey.mjs rider|driver /path/to/Debug.app <local-metro-port>',
  );
  process.exit(1);
}
const app = resolve(artifact);
const bundle = `co.roveride.${role}`;
const output = `reports/native-account-${role}`;
const command = (binary, args, timeout = 60000) =>
  execFileSync(binary, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  }).trim();
const simctl = (...args) => command('xcrun', ['simctl', ...args], 180000);
let device;
try {
  const identifier = command('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleIdentifier',
    `${app}/Info.plist`,
  ]);
  if (identifier !== bundle) throw new Error('Artifact does not match requested app.');
  const executable = command('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    `${app}/Info.plist`,
  ]);
  if (!existsSync(`${app}/${executable}.debug.dylib`))
    throw new Error('Expected a Debug simulator artifact with synthetic authentication enabled.');
  const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok || !(await response.text()).includes('packager-status:running'))
    throw new Error('Local Metro is not ready.');
  const { runtimes } = JSON.parse(simctl('list', 'runtimes', '--json'));
  const runtime = runtimes
    .filter((r) => r.isAvailable && r.identifier.includes('.iOS-'))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (!runtime) throw new Error('No available iOS simulator runtime.');
  mkdirSync(output, { recursive: true });
  device = simctl(
    'create',
    `Rove account ${role} ${process.pid}`,
    'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
    runtime.identifier,
  );
  simctl('boot', device);
  simctl('bootstatus', device, '-b');
  simctl('install', device, app);
  simctl('launch', device, bundle, '-RCT_jsLocation', `127.0.0.1:${port}`);
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
      `${output}/results.xml`,
      '--test-output-dir',
      `${output}/details`,
      'native-tests/account-deletion.yaml',
    ],
    `${output}/maestro.log`,
    360000,
  );
  console.log(`${role}: native account deletion and withdrawal passed.`);
} catch (error) {
  console.error(`Native account journey failed: ${error.message}`);
  process.exitCode = 1;
  if (device) {
    try {
      simctl('io', device, 'screenshot', `${output}/failure.png`);
    } catch {
      console.error('Failure screenshot unavailable.');
    }
  }
} finally {
  if (device) {
    try {
      simctl('shutdown', device);
    } catch {
      /* Already stopped, or removal below will report failure. */
    }
    try {
      simctl('delete', device);
    } catch {
      console.error(`Could not remove test simulator ${device}.`);
      process.exitCode = 1;
    }
  }
}
