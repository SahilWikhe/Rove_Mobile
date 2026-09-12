import { ConfigurationError } from './config';
import { readRecoverySecret } from './hosting-config';
import { readRuntimeConfig } from './runtime-config';

/** Shape validation only: no provider calls, database connections or environment mutation. */
export function inspectEnvironment(
  env: Record<string, string | undefined>,
  expected: 'staging' | 'production',
) {
  const problems: string[] = [];
  if (env.ROVE_ENVIRONMENT !== expected) problems.push(`ROVE_ENVIRONMENT must be ${expected}`);
  try {
    readRuntimeConfig(env);
  } catch (error) {
    problems.push(
      ...(error instanceof ConfigurationError ? error.fields : ['configuration validation failed']),
    );
  }
  try {
    readRecoverySecret(env.CRON_SECRET);
  } catch {
    problems.push('CRON_SECRET');
  }
  return { valid: problems.length === 0, problems: [...new Set(problems)].sort() };
}
