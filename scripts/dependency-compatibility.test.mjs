import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const rider = createRequire(new URL('../apps/rider/package.json', import.meta.url));
const router = createRequire(rider.resolve('expo-router/package.json'));
const queryPath = router.resolve('query-string');

test('patched Expo query parsing preserves Unicode, spaces, arrays and malformed input handling', () => {
  const query = router('query-string');
  assert.equal(query.parse('destination=North+Hills').destination, 'North Hills');
  assert.equal(query.parse('q=caf%C3%A9').q, 'café');
  assert.deepEqual(query.parse('tag=a&tag=b').tag, ['a', 'b']);
  assert.equal(typeof query.parse('q=%E0%A4%A').q, 'string');
});
test('malformed percent sequences cannot monopolize the query decoder', () => {
  // A subprocess timeout catches synchronous CPU exhaustion, which an in-process timer cannot.
  execFileSync(
    process.execPath,
    ['-e', 'const q=require(' + JSON.stringify(queryPath) + '); q.parse("q="+"%EA".repeat(10000));'],
    { timeout: 3000, stdio: 'pipe' },
  );
});
test('the patched UUID dependency preserves the Xcode project identifier API', () => {
  const expo = createRequire(rider.resolve('expo/package.json'));
  const config = createRequire(expo.resolve('@expo/config/package.json'));
  const xcode = config('xcode');
  const project = xcode.project('fixture.pbxproj');
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});
