import { AccountClosureAuthorization } from '@rove/contracts';
import { readIdentityDeletionConfig } from './identity-deletion';
import { ConfigurationError } from './config';

export function readAccountClosureConfig(env: Record<string, string | undefined>) {
  if (env.ACCOUNT_CLOSURE_ENABLED !== undefined && !['true', 'false'].includes(env.ACCOUNT_CLOSURE_ENABLED))
    throw new ConfigurationError(['accountClosure']);
  if (env.ACCOUNT_CLOSURE_ENABLED !== 'true') return undefined;
  const policy = AccountClosureAuthorization.shape.policyReference.safeParse(
    env.ACCOUNT_CLOSURE_POLICY_REFERENCE,
  );
  const identity = readIdentityDeletionConfig(env);
  if (!policy.success || !identity) throw new ConfigurationError(['accountClosure']);
  return { policyReference: policy.data, identity };
}
