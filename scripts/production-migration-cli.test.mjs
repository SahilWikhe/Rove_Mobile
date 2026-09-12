import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
function run(args, env = {}) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'packages/database/src/production-migrate-cli.ts', ...args],
    {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      env: { PATH: process.env.PATH, ...env },
    },
  );
}
test('migration CLI rejects malformed invocation and hosting execution before connecting', () => {
  for (const args of [
    [],
    ['apply', 'ignored.env'],
    ['plan', 'ignored.env', 'unexpected'],
    ['apply', 'ignored.env', 'not-a-hash'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Usage:/);
    assert.equal(result.stdout, '');
  }
  assert.match(run(['plan', 'ignored.env'], { VERCEL: '1' }).stderr, /^Usage:/);
});
test('migration CLI uses only the explicit file and redacts invalid secrets and private paths', () => {
  const folder = mkdtempSync(join(tmpdir(), 'rove-release-cli-'));
  try {
    const file = join(folder, 'private.env');
    writeFileSync(
      file,
      'ROVE_ENVIRONMENT=production\nPRODUCTION_MIGRATION_DATABASE_URL=private-invalid-credential\n',
      { mode: 0o600 },
    );
    for (const input of [file, join(folder, 'missing.env')]) {
      const result = run(['plan', input], {
        ROVE_ENVIRONMENT: 'production',
        PRODUCTION_DATABASE_HOST: 'ambient-must-not-be-used',
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^Production migration failed\./);
      assert.ok(!result.stderr.includes(folder));
      assert.ok(!result.stderr.includes('private-invalid-credential'));
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
