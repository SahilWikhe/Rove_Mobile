import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readCliInput } from './cli-input';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'rove-cli-input-'));
  dirs.push(base);
  const root = join(base, 'approved');
  mkdirSync(root);
  return { base, root };
}
test('reads selected relative and absolute files inside the approved directory', () => {
  const { root } = fixture();
  mkdirSync(join(root, 'nested'));
  const file = join(root, 'nested', 'input.env');
  writeFileSync(file, 'ROVE_ENVIRONMENT=staging');
  expect(readCliInput('nested/input.env', root)).toBe('ROVE_ENVIRONMENT=staging');
  expect(readCliInput(file, root)).toBe('ROVE_ENVIRONMENT=staging');
});
test('rejects traversal, absolute external paths and symlink escapes', () => {
  const { base, root } = fixture();
  const outside = join(base, 'outside.env');
  writeFileSync(outside, 'PRIVATE=synthetic');
  symlinkSync(outside, join(root, 'escape.env'));
  mkdirSync(join(base, 'approved-other'));
  const sibling = join(base, 'approved-other', 'input.env');
  writeFileSync(sibling, 'PRIVATE=synthetic');
  for (const path of ['../outside.env', outside, 'escape.env', sibling])
    expect(() => readCliInput(path, root)).toThrow('within the working directory');
});
test('rejects directories, missing inputs and oversized files', () => {
  const { root } = fixture();
  expect(() => readCliInput('.', root)).toThrow();
  expect(() => readCliInput('missing', root)).toThrow();
  mkdirSync(join(root, 'nested'));
  expect(() => readCliInput('nested', root)).toThrow('regular file');
  writeFileSync(join(root, 'large'), Buffer.alloc(1024 * 1024 + 1));
  expect(() => readCliInput('large', root)).toThrow('1 MiB');
});
