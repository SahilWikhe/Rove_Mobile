import { expect, test } from 'vitest';
import { readDocumentCleanupConfig } from './document-cleanup-config';
const enabled = {
  DOCUMENT_CLEANUP_ENABLED: 'true',
  DOCUMENT_CLEANUP_POLICY_REFERENCE: 'synthetic-policy',
  DOCUMENT_S3_BUCKET: 'synthetic-documents',
  DOCUMENT_S3_REGION: 'us-east-2',
  DOCUMENT_S3_OWNER_ACCOUNT_ID: '123456789012',
  DOCUMENT_CLEANUP_AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/cleanup',
  DOCUMENT_AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/uploads',
};
test('cleanup is off by default and ignores unused credentials while off', () => {
  expect(readDocumentCleanupConfig({})).toBeUndefined();
  expect(readDocumentCleanupConfig({ ...enabled, DOCUMENT_CLEANUP_ENABLED: 'false' })).toBeUndefined();
});
test('enabling requires explicit policy, existing storage scope and a distinct owner-account role', () => {
  expect(readDocumentCleanupConfig(enabled)).toMatchObject({
    policyReference: 'synthetic-policy',
    roleArn: enabled.DOCUMENT_CLEANUP_AWS_ROLE_ARN,
  });
  for (const key of [
    'DOCUMENT_CLEANUP_POLICY_REFERENCE',
    'DOCUMENT_S3_BUCKET',
    'DOCUMENT_S3_REGION',
    'DOCUMENT_S3_OWNER_ACCOUNT_ID',
    'DOCUMENT_CLEANUP_AWS_ROLE_ARN',
  ])
    expect(() => readDocumentCleanupConfig({ ...enabled, [key]: undefined })).toThrow('documents.cleanup');
  for (const changes of [
    { DOCUMENT_CLEANUP_ENABLED: 'yes' },
    { DOCUMENT_CLEANUP_AWS_ROLE_ARN: 'arn:aws:iam::999999999999:role/cleanup' },
    { DOCUMENT_CLEANUP_AWS_ROLE_ARN: enabled.DOCUMENT_AWS_ROLE_ARN },
    { DOCUMENT_GUARDDUTY_ROLE_ARN: enabled.DOCUMENT_CLEANUP_AWS_ROLE_ARN },
  ])
    expect(() => readDocumentCleanupConfig({ ...enabled, ...changes })).toThrow('documents.cleanup');
});
