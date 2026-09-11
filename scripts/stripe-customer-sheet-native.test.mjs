import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the installed native patch itself, not a JavaScript copy of it.
test(
  'iOS CustomerSheet resolves overlapping refreshes exactly once',
  { skip: process.platform !== 'darwin' },
  () => {
    const source = readFileSync(
      new URL(
        '../apps/rider/node_modules/@stripe/stripe-react-native/ios/StripeSdkImpl+CustomerSheet.swift',
        import.meta.url,
      ),
      'utf8',
    );
    const start = source.indexOf('final class CustomerSheetPendingCallbacks<Value>');
    const end = source.indexOf('\nextension StripeSdkImpl', start);
    assert.ok(start >= 0 && end > start, 'The installed Stripe native patch is required');
    const dir = mkdtempSync(join(tmpdir(), 'rove-stripe-continuations-'));
    try {
      const file = join(dir, 'main.swift');
      writeFileSync(
        file,
        `import Foundation\n${source.slice(start, end)}\n` +
          `
let pending = CustomerSheetPendingCallbacks<Int>()
let resultLock = NSLock()
var requests = 0
var results: [Int: Int] = [:]
DispatchQueue.concurrentPerform(iterations: 100) { index in
    let first = pending.append { value in
        resultLock.lock()
        precondition(try! value.get() == 42)
        results[index, default: 0] += 1
        resultLock.unlock()
    }
    if first {
        resultLock.lock()
        requests += 1
        resultLock.unlock()
    }
}
precondition(requests == 1)
pending.resolve(42)
pending.resolve(42)
precondition(results.count == 100 && results.values.allSatisfy { $0 == 1 })
var next = 0
precondition(pending.append { value in
    precondition(try! value.get() == 7)
    precondition(pending.append { next = try! $0.get() })
    pending.resolve(9)
})
pending.resolve(7)
precondition(next == 9)
var canceled = false
precondition(pending.append { result in
    if case .failure(let error) = result { canceled = error is CancellationError }
})
pending.cancel()
precondition(canceled)
precondition(pending.append { next = try! $0.get() })
pending.resolve(11)
precondition(next == 11)
print("overlap, duplicate completion, subsequent refresh, cancellation and reentrancy passed")
`,
      );
      const result = spawnSync('xcrun', ['swift', '-swift-version', '5', file], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /reentrancy passed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
