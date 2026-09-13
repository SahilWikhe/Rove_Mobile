import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { absoluteTool, developerTool } from './developer-tool.mjs';

test('developer tools accept explicit executable paths and reject relative overrides', () => {
  assert.equal(
    developerTool('gh', { ROVE_GH_BINARY: process.execPath, PATH: '/untrusted' }),
    realpathSync(process.execPath),
  );
  assert.throws(() => developerTool('gh', { ROVE_GH_BINARY: 'gh', PATH: '/untrusted' }), /absolute/);
  assert.throws(() => developerTool('untrusted', {}), /Unsupported/);
});
test('nonexecutable files and directories are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'rove-tool-'));
  try {
    const path = join(root, 'gh');
    writeFileSync(path, 'not an executable', { mode: 0o600 });
    assert.throws(() => absoluteTool(path));
    assert.throws(() => absoluteTool(root), /regular file/);
    assert.throws(() => absoluteTool(undefined), /absolute/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
