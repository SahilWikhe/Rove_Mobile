import { nativeSmokeCommand } from './native-smoke-command.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [role, artifact, ...rest] = process.argv.slice(2);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
const port = process.env.SMOKE_EMULATOR_PORT || '5580';
const metroPort = process.env.ACCOUNT_METRO_PORT || '8191';
const apiPort = process.env.ACCOUNT_API_PORT || '8190';
if (
  !['rider', 'driver'].includes(role) ||
  !artifact ||
  rest.length ||
  !sdk ||
  ![metroPort, apiPort].every((p) => /^\d+$/.test(p) && +p >= 1024 && +p <= 65535) ||
  !/^\d{4}$/.test(port) ||
  +port < 5554 ||
  +port > 5682 ||
  +port % 2
) {
  console.error(
    'Usage: ANDROID_HOME=/sdk node scripts/android-account-journey.mjs rider|driver /path/to/debug.apk',
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
  if (run(analyzer, ['manifest', 'debuggable', apk]) !== 'true')
    throw new Error('Expected a debuggable artifact for synthetic authentication.');
  const metro = await fetch(`http://127.0.0.1:${metroPort}/status`, { signal: AbortSignal.timeout(5000) });
  if (!metro.ok || !(await metro.text()).includes('packager-status:running'))
    throw new Error('Local Metro is not ready.');
  avdHome = mkdtempSync(join(tmpdir(), 'rove-android-account-'));
  const env = { ...process.env, ANDROID_AVD_HOME: avdHome };
  run(
    manager,
    [
      'create',
      'avd',
      '--name',
      'rove-account',
      '--package',
      `system-images;android-36;google_apis;${abi}`,
      '--force',
    ],
    { env, input: 'no\n', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  mkdirSync('reports/native-account-android', { recursive: true });
  log = openSync(`reports/native-account-android/android-${role}-emulator.log`, 'w');
  emulator = spawn(
    emulatorPath,
    [
      '-avd',
      'rove-account',
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
  logcatFile = openSync(`reports/native-account-android/android-${role}-runtime.log`, 'w');
  logcat = spawn(
    adb,
    ['-s', serial, 'logcat', '-v', 'threadtime', 'AndroidRuntime:E', 'ActivityManager:I', '*:S'],
    { stdio: ['ignore', logcatFile, logcatFile] },
  );
  run(adb, ['-s', serial, 'shell', 'run-as', bundle, 'mkdir', '-p', 'shared_prefs']);
  run(
    adb,
    ['-s', serial, 'shell', 'run-as', bundle, 'sh', '-c', `"cat > shared_prefs/${bundle}_preferences.xml"`],
    {
      input:
        '<?xml version="1.0" encoding="utf-8" standalone="yes" ?><map><string name="debug_http_host">127.0.0.1:8081</string></map>',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  run(adb, ['-s', serial, 'reverse', 'tcp:8081', `tcp:${metroPort}`]);
  run(adb, ['-s', serial, 'reverse', `tcp:${apiPort}`, `tcp:${apiPort}`]);
  run(adb, ['-s', serial, 'shell', 'am', 'start', '-W', '-n', `${bundle}/${bundle}.MainActivity`]);
  nativeSmokeCommand(
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
      `reports/native-account-android/android-${role}.xml`,
      '--test-output-dir',
      `reports/native-account-android/android-${role}-details`,
      '--debug-output',
      `reports/native-account-android/android-${role}-debug`,
      'native-tests/account-deletion.yaml',
    ],
    `reports/native-account-android/android-${role}-maestro.log`,
    360000,
  );
  console.log(`${role}: Android account deletion and withdrawal verified on a fresh emulator.`);
} catch (error) {
  console.error('Android account journey failed:', error.message);
  if (emulator) {
    try {
      run(adb, ['-s', serial, 'shell', 'screencap', '-p', '/sdcard/account-failure.png']);
      run(adb, [
        '-s',
        serial,
        'pull',
        '/sdcard/account-failure.png',
        `reports/native-account-android/${role}-failure.png`,
      ]);
    } catch {
      console.error('Failure screenshot unavailable.');
    }
  }
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
