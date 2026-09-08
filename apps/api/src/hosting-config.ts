import { ConfigurationError } from './config';

/** Shared by hosted startup and offline preflight; never expose the supplied secret. */
export function readRecoverySecret(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new ConfigurationError(['CRON_SECRET']);
  return value;
}
