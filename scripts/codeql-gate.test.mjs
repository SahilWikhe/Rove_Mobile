import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingFindings } from './codeql-gate.mjs';
test('code scanning blocks medium-or-higher security findings and error-level results', () => {
  const report = {
    runs: [
      {
        tool: {
          driver: {
            rules: [
              { id: 'security', properties: { 'security-severity': '7.5' } },
              { id: 'advice', defaultConfiguration: { level: 'note' } },
            ],
          },
        },
        results: [
          { ruleId: 'security', level: 'warning' },
          { ruleId: 'advice' },
          { ruleId: 'error', level: 'error' },
        ],
      },
    ],
  };
  assert.equal(blockingFindings(report).length, 2);
  assert.throws(() => blockingFindings({}));
  assert.deepEqual(blockingFindings({ runs: [{ results: [] }] }), []);
});
