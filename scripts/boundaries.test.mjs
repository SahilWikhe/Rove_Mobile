import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violations } from './boundaries.mjs';
test('blocks named, relative, dynamic and re-exported server dependencies in mobile code', () => {
  for (const text of [
    "import { x } from '@rove/server';",
    "export * from '@rove/database';",
    "const x = import('@rove/server');",
    "const x = require('node:fs');",
    "import x from '../../../../packages/database/src/index';",
  ])
    assert.ok(violations('apps/rider/src/app/index.tsx', text).length, text);
});
test('allows shared contracts and isolates the disposable database helper', () => {
  assert.deepEqual(
    violations('apps/rider/src/app/index.tsx', "import { Quote } from '@rove/contracts';"),
    [],
  );
  assert.ok(
    violations('apps/api/src/index.ts', "import { testDatabase } from '@rove/database/testing';").length,
  );
  assert.deepEqual(
    violations('apps/api/src/local.ts', "import { testDatabase } from '@rove/database/testing';"),
    [],
  );
});
