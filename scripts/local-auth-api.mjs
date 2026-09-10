import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep terminal signals away from embedded PostgreSQL until the API drains its pool.
// The child remains supervised; it is not unref'd or left running after this launcher exits.
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/local.ts'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, ROVE_LOCAL_AUTH: 'auth0' },
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
let stopping = false;
let deadline;
function stop() {
  if (stopping) return;
  stopping = true;
  // embedded-postgres also handles OS signals. IPC lets our API drain before it stops Postgres.
  if (child.connected) child.send({ type: 'rove:shutdown' });
  deadline = setTimeout(() => {
    console.error('Local API cleanup timed out; terminating the isolated process group.');
    if (process.platform !== 'win32' && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Already stopped. */
      }
    } else child.kill('SIGKILL');
  }, 15000);
  deadline.unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.once('error', () => {
  console.error('Unable to launch the local Auth0 API.');
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  clearTimeout(deadline);
  process.exitCode = code ?? (signal ? 1 : 0);
});
