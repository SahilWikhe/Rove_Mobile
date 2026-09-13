import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentCleanupTemplate } from './document-cleanup-template.mjs';
const input = {
  issuerMode: 'team',
  team: 'fixture-team',
  project: 'rove-api-staging',
  environment: 'production',
  account: '123456789012',
  bucket: 'synthetic-documents',
  uploaderPolicyArn: 'arn:aws:iam::123456789012:policy/uploader',
  existingProviderArn: 'arn:aws:iam::123456789012:oidc-provider/oidc.vercel.com/fixture-team',
};
const baseline = {
  Policies: [
    {
      Policy: {
        Statement: [
          {
            Action: [
              's3:GetBucketVersioning',
              's3:ListBucketVersions',
              's3:DeleteObjectVersion',
              's3:DeleteObject',
              's3:BypassGovernanceRetention',
              's3:GetObject',
            ],
          },
        ],
      },
    },
  ],
};
test('narrows generated permissions to approved version-only operations and document prefixes', () => {
  const t = documentCleanupTemplate(input, baseline);
  const role = t.Resources.DocumentCleanupRole.Properties;
  assert.equal(role.ManagedPolicyArns, undefined);
  const statements = role.Policies[0].PolicyDocument.Statement;
  assert.deepEqual(
    statements.map((s) => s.Action),
    ['s3:GetBucketVersioning', 's3:ListBucketVersions', 's3:DeleteObjectVersion'],
  );
  assert.deepEqual(statements[1].Condition.StringLike['s3:prefix'], [
    'driver-documents/inbox/*',
    'driver-documents/quarantine/*',
  ]);
  assert.deepEqual(statements[2].Resource, [
    'arn:aws:s3:::synthetic-documents/driver-documents/inbox/*',
    'arn:aws:s3:::synthetic-documents/driver-documents/quarantine/*',
  ]);
  assert.deepEqual(role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals, {
    'oidc.vercel.com/fixture-team:aud': 'https://vercel.com/fixture-team',
    'oidc.vercel.com/fixture-team:sub': 'owner:fixture-team:project:rove-api-staging:environment:production',
  });
  assert.deepEqual(Object.keys(t.Resources), ['DocumentCleanupRole']);
});
test('rejects unverified baseline, bucket, wildcard trust and provider crossover', () => {
  assert.throws(() => documentCleanupTemplate(input, { Policies: [] }));
  for (const override of [
    { bucket: '*' },
    { bucket: 'other/bucket' },
    { team: '*' },
    { existingProviderArn: undefined },
    { existingProviderArn: 'arn:aws:iam::999999999999:oidc-provider/oidc.vercel.com/fixture-team' },
  ])
    assert.throws(() => documentCleanupTemplate({ ...input, ...override }, baseline));
});
