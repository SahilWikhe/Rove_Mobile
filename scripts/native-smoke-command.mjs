import { execFileSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

/** Preserve native-tool output even on a timeout or nonzero exit, without pipe buffer limits. */
export function nativeSmokeCommand(binary, args, outputPath, timeout = 180000) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const log = openSync(outputPath, 'w');
  try {
    execFileSync(binary, args, { stdio: ['ignore', log, log], timeout });
  } catch (error) {
    const reason =
      error.code === 'ETIMEDOUT' ? 'timed out' : `failed (${error.status ?? error.code ?? 'unknown'})`;
    throw new Error(`Native UI command ${reason}. Output: ${outputPath}`, { cause: error });
  } finally {
    closeSync(log);
  }
}
