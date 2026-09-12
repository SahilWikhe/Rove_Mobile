import { inspectEnvironment } from './environment-preflight';

export function inspectStagingEnvironment(env: Record<string, string | undefined>) {
  return inspectEnvironment(env, 'staging');
}
