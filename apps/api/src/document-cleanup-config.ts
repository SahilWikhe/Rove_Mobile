import { z } from 'zod';
import { DocumentCleanupApproval } from '@rove/contracts';
import { S3DocumentConfig } from '@rove/server';
import { ConfigurationError } from './config';

export function readDocumentCleanupConfig(env: Record<string, string | undefined>) {
  if (env.DOCUMENT_CLEANUP_ENABLED !== undefined && !['true', 'false'].includes(env.DOCUMENT_CLEANUP_ENABLED))
    throw new ConfigurationError(['documents.cleanup']);
  if (env.DOCUMENT_CLEANUP_ENABLED !== 'true') return undefined;
  const storage = S3DocumentConfig.safeParse({
    bucket: env.DOCUMENT_S3_BUCKET,
    region: env.DOCUMENT_S3_REGION,
    ownerAccountId: env.DOCUMENT_S3_OWNER_ACCOUNT_ID,
  });
  const role = z
    .string()
    .regex(/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/)
    .safeParse(env.DOCUMENT_CLEANUP_AWS_ROLE_ARN);
  const policy = DocumentCleanupApproval.shape.policyReference.safeParse(
    env.DOCUMENT_CLEANUP_POLICY_REFERENCE,
  );
  if (
    !storage.success ||
    !role.success ||
    !policy.success ||
    role.data.split(':')[4] !== storage.data.ownerAccountId ||
    role.data === env.DOCUMENT_AWS_ROLE_ARN ||
    role.data === env.DOCUMENT_GUARDDUTY_ROLE_ARN
  )
    throw new ConfigurationError(['documents.cleanup']);
  return { storage: storage.data, roleArn: role.data, policyReference: policy.data };
}
