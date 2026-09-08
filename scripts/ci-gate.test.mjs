import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredJobs, gateFailures } from './ci-gate.mjs';
const success = () => Object.fromEntries(requiredJobs.map((name) => [name, { result: 'success' }]));
test('requires every known job for docs, app, shared and workflow changes alike', () => {
  assert.deepEqual(gateFailures(success()), []);
  for (const name of requiredJobs) {
    for (const state of ['failure', 'cancelled', 'skipped', 'unknown']) {
      assert.equal(gateFailures({ ...success(), [name]: { result: state } }).length, 1);
    }
    const missing = success();
    delete missing[name];
    assert.equal(gateFailures(missing).length, 1);
  }
  assert.ok(gateFailures(null).length);
});
