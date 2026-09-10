import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Generate a single-project, single-environment trust policy; never use wildcard subjects. */
export function documentOidcTemplate(input) {
  const { team, project, environment, account, uploaderPolicyArn, existingProviderArn } = input;
  const label = /^[a-z0-9][a-z0-9-]{0,99}$/;
  if (
    !label.test(team ?? '') ||
    !label.test(project ?? '') ||
    !['production', 'preview', 'development'].includes(environment) ||
    !/^\d{12}$/.test(account ?? '')
  )
    throw new Error('Invalid identity scope.');
  if (!new RegExp(`^arn:aws:iam::${account}:policy/[A-Za-z0-9+=,.@_/-]+$`).test(uploaderPolicyArn ?? ''))
    throw new Error('Uploader policy must belong to the selected AWS account.');
  const issuer = `oidc.vercel.com/${team}`;
  const providerArn = `arn:aws:iam::${account}:oidc-provider/${issuer}`;
  if (existingProviderArn !== undefined && existingProviderArn !== providerArn)
    throw new Error('Existing provider does not match the exact team issuer.');
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Rove document uploader identity for one Vercel project/environment using the team issuer.',
    Resources: {
      ...(!existingProviderArn
        ? {
            VercelProvider: {
              Type: 'AWS::IAM::OIDCProvider',
              Properties: { Url: `https://${issuer}`, ClientIdList: [`https://vercel.com/${team}`] },
            },
          }
        : {}),
      DocumentRuntimeRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Federated: existingProviderArn ?? { Ref: 'VercelProvider' } },
                Action: 'sts:AssumeRoleWithWebIdentity',
                Condition: {
                  StringEquals: {
                    [`${issuer}:aud`]: `https://vercel.com/${team}`,
                    [`${issuer}:sub`]: `owner:${team}:project:${project}:environment:${environment}`,
                  },
                },
              },
            ],
          },
          ManagedPolicyArns: [uploaderPolicyArn],
          Tags: [
            { Key: 'Application', Value: 'Rove' },
            { Key: 'VercelProject', Value: project },
            { Key: 'VercelEnvironment', Value: environment },
          ],
        },
      },
    },
    Outputs: { DocumentAwsRoleArn: { Value: { 'Fn::GetAtt': ['DocumentRuntimeRole', 'Arn'] } } },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Input required');
    console.log(
      JSON.stringify(documentOidcTemplate(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2),
    );
  } catch {
    console.error(
      'Supply one JSON file with team, project, environment, account, uploaderPolicyArn and optional existingProviderArn. Verify the Vercel team issuer before deployment.',
    );
    process.exitCode = 1;
  }
}
