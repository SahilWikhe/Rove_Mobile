import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentOidcTemplate } from './document-oidc-template.mjs';
const input = {
  team: 'fixture-team',
  project: 'rove-api-staging',
  environment: 'production',
  account: '123456789012',
  uploaderPolicyArn: 'arn:aws:iam::123456789012:policy/fixture-uploader',
};
test('trust is exact to team/project/environment and grants only the supplied uploader policy', () => {
  const t = documentOidcTemplate(input);
  const p = t.Resources.DocumentRuntimeRole.Properties;
  assert.deepEqual(p.ManagedPolicyArns, [input.uploaderPolicyArn]);
  assert.deepEqual(p.AssumeRolePolicyDocument.Statement[0].Condition, {
    StringEquals: {
      'oidc.vercel.com/fixture-team:aud': 'https://vercel.com/fixture-team',
      'oidc.vercel.com/fixture-team:sub':
        'owner:fixture-team:project:rove-api-staging:environment:production',
    },
  });
  assert.equal(JSON.stringify(t).includes('*'), false);
});
test('rejects wildcard, separator injection, missing fields and policy account crossover', () => {
  for (const override of [
    { team: '*' },
    { project: 'app:environment:production' },
    { environment: '*' },
    { account: '' },
    { uploaderPolicyArn: 'arn:aws:iam::999999999999:policy/admin' },
  ])
    assert.throws(() => documentOidcTemplate({ ...input, ...override }));
});
test('reuses an exact team issuer without creating a duplicate provider', () => {
  const arn = 'arn:aws:iam::123456789012:oidc-provider/oidc.vercel.com/fixture-team';
  const t = documentOidcTemplate({ ...input, existingProviderArn: arn });
  assert.equal(t.Resources.VercelProvider, undefined);
  assert.equal(
    t.Resources.DocumentRuntimeRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Federated,
    arn,
  );
  assert.throws(() => documentOidcTemplate({ ...input, existingProviderArn: arn + '-other' }));
});
