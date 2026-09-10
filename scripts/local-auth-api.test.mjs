import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`local auth launcher drains PostgreSQL before ${signal} exit`, { timeout: 90000 }, async () => {
    const env = { ...process.env, NODE_ENV: 'test', ROVE_LOCAL_PORT: '0' };
    delete env.ROVE_E2E;
    delete env.VERCEL;
    const child = spawn(process.execPath, ['scripts/local-auth-api.mjs'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    const exited = once(child, 'exit');
    try {
      const deadline = Date.now() + 60000;
      while (!/Local Rove API: http:\/\/localhost:\d+\./.test(output)) {
        assert.equal(child.exitCode, null, 'Local auth API exited before readiness');
        assert.ok(Date.now() < deadline, 'Local auth API did not become ready');
        await delay(100);
      }
      // Allow the worker to establish and release pooled connections before requesting shutdown.
      await delay(700);
      child.kill(signal);
      const [code, exitSignal] = await exited;
      assert.equal(code, 0, 'Supervised shutdown must finish successfully');
      assert.equal(exitSignal, null);
      assert.ok(output.includes('database system is shut down'), 'Embedded database must stop');
      assert.ok(!output.includes('Unhandled'), 'Shutdown must not produce an unhandled error');
      assert.ok(!output.includes('cleanup timed out'), 'Shutdown must drain without forced termination');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await exited;
      }
    }
  });
}
