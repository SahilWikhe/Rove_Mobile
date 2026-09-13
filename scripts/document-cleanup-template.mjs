import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { documentOidcTemplate } from './document-oidc-template.mjs';

// Autopilot supplies the SDK action baseline. The user's approved version-only
// scope excludes its optional unversioned/Object Lambda/governance actions.
export function documentCleanupTemplate(input, baseline) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket ?? ''))
    throw new Error('Invalid document bucket.');
  if (!input.existingProviderArn) throw new Error('Existing project OIDC provider required.');
  const generated = new Set(
    baseline.Policies.flatMap(({ Policy }) =>
      Policy.Statement.flatMap(({ Action }) => (Array.isArray(Action) ? Action : [Action])),
    ),
  );
  const allowed = ['s3:GetBucketVersioning', 's3:ListBucketVersions', 's3:DeleteObjectVersion'];
  if (!allowed.every((action) => generated.has(action)))
    throw new Error('Incomplete generated cleanup baseline.');
  const reference = documentOidcTemplate(input);
  const bucket = `arn:aws:s3:::${input.bucket}`;
  const prefixes = ['driver-documents/inbox/*', 'driver-documents/quarantine/*'];
  const policy = {
    Version: '2012-10-17',
    Statement: [
      { Sid: 'VerifyBucketVersioning', Effect: 'Allow', Action: allowed[0], Resource: bucket },
      {
        Sid: 'DiscoverDocumentVersions',
        Effect: 'Allow',
        Action: allowed[1],
        Resource: bucket,
        Condition: { StringLike: { 's3:prefix': prefixes } },
      },
      {
        Sid: 'RemoveExactDocumentVersions',
        Effect: 'Allow',
        Action: allowed[2],
        Resource: prefixes.map((prefix) => `${bucket}/${prefix}`),
      },
    ],
  };
  const properties = reference.Resources.DocumentRuntimeRole.Properties;
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'Rove version-only document cleanup identity. Creating this role does not enable runtime deletion.',
    Resources: {
      DocumentCleanupRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: properties.AssumeRolePolicyDocument,
          Policies: [{ PolicyName: 'ExactDocumentVersions', PolicyDocument: policy }],
          Tags: [...properties.Tags, { Key: 'Purpose', Value: 'DocumentCleanup' }],
        },
      },
    },
    Outputs: { DocumentCleanupAwsRoleArn: { Value: { 'Fn::GetAtt': ['DocumentCleanupRole', 'Arn'] } } },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Input and generated baseline required.');
    console.log(
      JSON.stringify(
        documentCleanupTemplate(
          JSON.parse(readFileSync(process.argv[2], 'utf8')),
          JSON.parse(readFileSync(process.argv[3], 'utf8')),
        ),
        null,
        2,
      ),
    );
  } catch {
    console.error('Provide the verified document OIDC scope/bucket JSON and Autopilot baseline JSON.');
    process.exitCode = 1;
  }
}
