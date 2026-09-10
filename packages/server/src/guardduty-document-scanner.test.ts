import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import {
  GuardDutyDocumentScanner,
  protectsScanTags,
  type ScanOperations,
} from './guardduty-document-scanner';
const config = {
  bucket: 'rove-synthetic-private',
  region: 'us-east-2',
  ownerAccountId: '111122223333',
  scannerRoleArn: 'arn:aws:iam::111122223333:role/rove-guardduty',
};
const deny = {
  Effect: 'Deny',
  Principal: '*',
  Action: [
    's3:PutObjectTagging',
    's3:PutObjectVersionTagging',
    's3:DeleteObjectTagging',
    's3:DeleteObjectVersionTagging',
  ],
  Resource: 'arn:aws:s3:::rove-synthetic-private/driver-documents/quarantine/*',
  Condition: { ArnNotEquals: { 'aws:PrincipalArn': config.scannerRoleArn } },
};
const policy = JSON.stringify({ Version: '2012-10-17', Statement: [deny] });
function fixture(status = 'NO_THREATS_FOUND') {
  const documentId = randomUUID();
  const target = {
    documentId,
    key: `driver-documents/quarantine/${documentId}/${randomUUID()}`,
    version: 'fixture-version',
    sha256: 'a'.repeat(64),
  };
  const operations: ScanOperations = {
    policy: vi.fn(async () => ({ Policy: policy, $metadata: {} })),
    tags: vi.fn(async () => ({
      VersionId: target.version,
      TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: status }],
      $metadata: {},
    })),
  };
  return {
    target,
    operations,
    scanner: new GuardDutyDocumentScanner(config, operations),
    signal: new AbortController().signal,
  };
}
test.each([
  ['NO_THREATS_FOUND', 'clean'],
  ['THREATS_FOUND', 'infected'],
])('maps only explicit %s evidence', async (status, verdict) => {
  const f = fixture(status);
  expect(await f.scanner.scan(f.target, f.signal)).toEqual({ ...f.target, verdict });
  expect(f.operations.tags).toHaveBeenCalledWith(
    {
      Bucket: config.bucket,
      ExpectedBucketOwner: config.ownerAccountId,
      Key: f.target.key,
      VersionId: f.target.version,
    },
    expect.any(AbortSignal),
  );
});
test.each(['UNSUPPORTED', 'ACCESS_DENIED', 'FAILED', 'UNKNOWN', ''])(
  'keeps %s files quarantined',
  async (status) => {
    const f = fixture(status);
    await expect(f.scanner.scan(f.target, f.signal)).rejects.toMatchObject({
      code: 'DOCUMENT_SCAN_UNAVAILABLE',
    });
  },
);
test.each([undefined, 'other-version', 'null'])('rejects result version %s', async (VersionId) => {
  const f = fixture();
  f.operations.tags = vi.fn(async () => ({
    VersionId,
    TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' }],
    $metadata: {},
  }));
  await expect(f.scanner.scan(f.target, f.signal)).rejects.toMatchObject({
    code: 'DOCUMENT_SCAN_UNAVAILABLE',
  });
});
test('rejects missing and ambiguous tags', async () => {
  for (const TagSet of [
    [],
    [
      { Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' },
      { Key: 'GuardDutyMalwareScanStatus', Value: 'THREATS_FOUND' },
    ],
  ]) {
    const f = fixture();
    f.operations.tags = vi.fn(async () => ({ VersionId: f.target.version, TagSet, $metadata: {} }));
    await expect(f.scanner.scan(f.target, f.signal)).rejects.toMatchObject({
      code: 'DOCUMENT_SCAN_UNAVAILABLE',
    });
  }
});
test('refuses tag evidence unless bucket policy prevents tampering', async () => {
  const f = fixture();
  f.operations.policy = vi.fn(async () => ({ Policy: '{"Statement":[]}', $metadata: {} }));
  await expect(f.scanner.scan(f.target, f.signal)).rejects.toMatchObject({
    code: 'DOCUMENT_SCAN_UNAVAILABLE',
  });
  expect(f.operations.tags).not.toHaveBeenCalled();
});
test('requires all tag operations, exact role exception, protected prefix and no weakening condition', () => {
  expect(protectsScanTags(policy, config.bucket, config.scannerRoleArn)).toBe(true);
  for (const changed of [
    { ...deny, Effect: 'Allow' },
    { ...deny, Principal: { AWS: config.scannerRoleArn } },
    { ...deny, Action: deny.Action.slice(1) },
    { ...deny, Resource: 'arn:aws:s3:::other-bucket/*' },
    { ...deny, Condition: { ...deny.Condition, Bool: { 'aws:SecureTransport': 'false' } } },
    { ...deny, Condition: { ArnNotEquals: { 'aws:PrincipalArn': 'arn:aws:iam::111122223333:role/other' } } },
  ])
    expect(
      protectsScanTags(JSON.stringify({ Statement: [changed] }), config.bucket, config.scannerRoleArn),
    ).toBe(false);
  expect(protectsScanTags('malformed', config.bucket, config.scannerRoleArn)).toBe(false);
});
test('does not request another document path or a mutable null version', async () => {
  for (const changes of [
    { key: 'driver-documents/inbox/file' },
    { documentId: randomUUID() },
    { version: 'null' },
  ]) {
    const f = fixture();
    await expect(f.scanner.scan({ ...f.target, ...changes }, f.signal)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
    });
    expect(f.operations.policy).not.toHaveBeenCalled();
  }
});
test('abort and AWS errors do not leak provider diagnostics', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(f.scanner.scan(f.target, controller.signal)).rejects.toMatchObject({
    code: 'DOCUMENT_SCAN_UNAVAILABLE',
  });
  expect(f.operations.policy).not.toHaveBeenCalled();
  f.operations.policy = vi.fn(async () => {
    throw new Error('private object diagnostic');
  });
  await expect(f.scanner.scan(f.target, f.signal)).rejects.toMatchObject({
    message: 'Document scanning could not be verified.',
  });
});
test('infrastructure keeps scanning opt-in and installs the exact required tag protection', () => {
  const template = JSON.parse(
    readFileSync(new URL('../../../infra/aws/driver-documents.template.json', import.meta.url), 'utf8'),
  );
  expect(template.Parameters.EnableMalwareScanning.Default).toBe('false');
  expect(template.Resources.DocumentMalwareProtection.Condition).toBe('ScanningEnabled');
  expect(template.Resources.DocumentMalwareProtection.Properties.Actions.Tagging.Status).toBe('ENABLED');
  expect(
    template.Resources.DocumentMalwareProtection.Properties.ProtectedResource.S3Bucket.ObjectPrefixes,
  ).toEqual(['driver-documents/quarantine/']);
  const entry = template.Resources.DocumentBucketPolicy.Properties.PolicyDocument.Statement.find(
    (value: Record<string, unknown[]>) => value['Fn::If']?.[0] === 'ScanningEnabled',
  )['Fn::If'][1];
  const resolved = {
    ...entry,
    Resource: deny.Resource,
    Condition: { ArnNotEquals: { 'aws:PrincipalArn': config.scannerRoleArn } },
  };
  expect(entry.Resource).toEqual({ 'Fn::Sub': '${DocumentBucket.Arn}/driver-documents/quarantine/*' });
  expect(entry.Condition.ArnNotEquals['aws:PrincipalArn']).toEqual({
    'Fn::GetAtt': ['DocumentScannerRole', 'Arn'],
  });
  expect(
    protectsScanTags(JSON.stringify({ Statement: [resolved] }), config.bucket, config.scannerRoleArn),
  ).toBe(true);
  expect(template.Resources.DocumentScannerRole.Properties.AssumeRolePolicyDocument.Statement).toEqual([
    {
      Effect: 'Allow',
      Principal: { Service: 'malware-protection-plan.guardduty.amazonaws.com' },
      Action: 'sts:AssumeRole',
    },
  ]);
});
