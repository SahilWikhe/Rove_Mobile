import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [role, artifact, ...rest] = process.argv.slice(2);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
const port = process.env.SMOKE_EMULATOR_PORT || '5580';
if (
  !['rider', 'driver'].includes(role) ||
  !artifact ||
  rest.length ||
  !sdk ||
  !/^\d{4}$/.test(port) ||
  +port < 5554 ||
  +port > 5682 ||
  +port % 2
) {
  console.error(
    'Usage: ANDROID_HOME=/sdk node scripts/android-release-smoke.mjs rider|driver /path/to/release.apk',
  );
  process.exit(1);
}
const apk = resolve(artifact),
  serial = `emulator-${port}`;
const adb = join(sdk, 'platform-tools/adb');
const manager = join(sdk, 'cmdline-tools/latest/bin/avdmanager');
const emulatorPath = join(sdk, 'emulator/emulator');
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
    ...options,
  }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let avdHome, emulator, log, logcat, logcatFile;
try {
  if (
    ![
      apk,
      adb,
      manager,
      emulatorPath,
      join(sdk, `system-images/android-36/google_apis/${abi}/system.img`),
    ].every(existsSync)
  )
    throw new Error('APK, SDK tools or API 36 Google APIs system image is missing.');
  if (
    run(adb, ['devices'])
      .split('\n')
      .some((line) => line.startsWith(`${serial}\t`))
  )
    throw new Error('Smoke emulator port is already in use. Existing device left untouched.');
  const bundle = `co.roveride.${role}`;
  const analyzer = join(sdk, 'cmdline-tools/latest/bin/apkanalyzer');
  if (run(analyzer, ['manifest', 'application-id', apk]) !== bundle)
    throw new Error('Artifact does not match the requested app.');
  avdHome = mkdtempSync(join(tmpdir(), 'rove-android-smoke-'));
  const env = { ...process.env, ANDROID_AVD_HOME: avdHome };
  run(
    manager,
    [
      'create',
      'avd',
      '--name',
      'rove-smoke',
      '--package',
      `system-images;android-36;google_apis;${abi}`,
      '--force',
    ],
    { env, input: 'no\n', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  mkdirSync('reports/native-smoke', { recursive: true });
  log = openSync(`reports/native-smoke/android-${role}-emulator.log`, 'w');
  emulator = spawn(
    emulatorPath,
    [
      '-avd',
      'rove-smoke',
      '-port',
      port,
      '-no-window',
      '-no-audio',
      '-no-snapshot',
      '-no-boot-anim',
      '-gpu',
      'swiftshader_indirect',
      '-memory',
      '2048',
      '-cores',
      '2',
    ],
    { env, stdio: ['ignore', log, log] },
  );
  let spawnError;
  emulator.on('error', (error) => {
    spawnError = error;
  });
  const deadline = Date.now() + 180000;
  let booted = false;
  while (Date.now() < deadline) {
    if (spawnError || emulator.exitCode !== null) throw new Error('Smoke emulator exited before boot.');
    try {
      booted = run(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { timeout: 5000 }) === '1';
    } catch {
      /* Still booting. */
    }
    if (booted) break;
    await sleep(1000);
  }
  if (!booted) throw new Error('Smoke emulator boot timed out.');
  run(adb, ['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  run(adb, ['-s', serial, 'shell', 'wm', 'dismiss-keyguard']);
  run(adb, ['-s', serial, 'install', apk]);
  logcatFile = openSync(`reports/native-smoke/android-${role}-runtime.log`, 'w');
  logcat = spawn(
    adb,
    ['-s', serial, 'logcat', '-v', 'threadtime', 'AndroidRuntime:E', 'ActivityManager:I', '*:S'],
    { stdio: ['ignore', logcatFile, logcatFile] },
  );
  run(
    process.env.MAESTRO_BINARY || 'maestro',
    [
      '--device',
      serial,
      'test',
      '-e',
      `APP_ID=${bundle}`,
      '--format',
      'junit',
      '--output',
      `reports/native-smoke/android-${role}.xml`,
      '--test-output-dir',
      `reports/native-smoke/android-${role}-details`,
      '--debug-output',
      `reports/native-smoke/android-${role}-debug`,
      'native-tests/release-welcome.yaml',
    ],
    { timeout: 180000 },
  );
  console.log(`${role}: standalone Android welcome and relaunch verified on a fresh emulator.`);
} catch (error) {
  console.error('Android release smoke failed:', error.message);
  process.exitCode = 1;
} finally {
  if (logcat) logcat.kill('SIGTERM');
  if (logcatFile !== undefined) closeSync(logcatFile);
  if (emulator) {
    emulator.kill('SIGTERM');
    const deadline = Date.now() + 10000;
    while (emulator.exitCode === null && emulator.signalCode === null && Date.now() < deadline)
      await sleep(100);
    if (emulator.exitCode === null && emulator.signalCode === null) emulator.kill('SIGKILL');
  }
  if (log !== undefined) closeSync(log);
  if (avdHome) rmSync(avdHome, { recursive: true, force: true });
}
