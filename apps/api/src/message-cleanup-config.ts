import { MessageCleanupAuthorization } from '@rove/contracts';
import { ConfigurationError } from './config';

export function readMessageCleanupConfig(env: Record<string, string | undefined>) {
  if (env.MESSAGE_CLEANUP_ENABLED !== undefined && !['true', 'false'].includes(env.MESSAGE_CLEANUP_ENABLED))
    throw new ConfigurationError(['messageCleanup']);
  if (env.MESSAGE_CLEANUP_ENABLED !== 'true') return undefined;
  const policy = MessageCleanupAuthorization.shape.policyReference.safeParse(
    env.MESSAGE_CLEANUP_POLICY_REFERENCE,
  );
  if (!policy.success) throw new ConfigurationError(['messageCleanup']);
  return { policyReference: policy.data };
}
