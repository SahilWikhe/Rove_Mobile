import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeSmokeCommand } from './native-smoke-command.mjs';
function fixture(work) {
  const dir = mkdtempSync(join(tmpdir(), 'rove-native-log-'));
  try {
    work(join(dir, 'nested path', 'tool.log'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('preserves large stdout and stderr without a pipe buffer limit', () =>
  fixture((path) => {
    nativeSmokeCommand(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(2_000_000)); process.stderr.write('stderr-end')"],
      path,
    );
    const text = readFileSync(path, 'utf8');
    assert.equal(text.length, 2_000_010);
    assert.ok(text.endsWith('stderr-end'));
  }));
test('retains tool details on nonzero exit and reports the evidence path', () =>
  fixture((path) => {
    assert.throws(
      () =>
        nativeSmokeCommand(
          process.execPath,
          ['-e', "console.error('synthetic driver startup failure');process.exit(7)"],
          path,
        ),
      (error) => error.message.includes('failed (7)') && error.message.includes(path),
    );
    assert.match(readFileSync(path, 'utf8'), /synthetic driver startup failure/);
  }));
test('timeout still leaves startup output available for diagnosis', () =>
  fixture((path) => {
    assert.throws(
      () =>
        nativeSmokeCommand(
          process.execPath,
          ['-e', "console.log('synthetic startup');setInterval(()=>{},1000)"],
          path,
          1000,
        ),
      /timed out/,
    );
    assert.match(readFileSync(path, 'utf8'), /synthetic startup/);
  }));
