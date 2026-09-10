import { z } from 'zod';
import {
  S3Client,
  GetBucketPolicyCommand,
  GetObjectTaggingCommand,
  type GetBucketPolicyCommandOutput,
  type GetObjectTaggingCommandInput,
  type GetObjectTaggingCommandOutput,
} from '@aws-sdk/client-s3';
import { S3DocumentConfig } from './s3-document-config';
import type { DocumentScanner, ScanTarget } from './document-scanning';
import { DomainError } from './errors';

export const GuardDutyScanConfig = S3DocumentConfig.extend({
  scannerRoleArn: z.string().regex(/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/),
}).refine((value) => value.scannerRoleArn.split(':')[4] === value.ownerAccountId);
export interface ScanOperations {
  policy(signal: AbortSignal): Promise<GetBucketPolicyCommandOutput>;
  tags(input: GetObjectTaggingCommandInput, signal: AbortSignal): Promise<GetObjectTaggingCommandOutput>;
}
const protectedActions = [
  's3:PutObjectTagging',
  's3:PutObjectVersionTagging',
  's3:DeleteObjectTagging',
  's3:DeleteObjectVersionTagging',
];
const Policy = z.object({ Statement: z.array(z.record(z.string(), z.unknown())) });
/** Explicit denies win over other grants; reject extra conditions that could weaken the required deny. */
export function protectsScanTags(raw: string, bucket: string, role: string): boolean {
  try {
    return Policy.parse(JSON.parse(raw)).Statement.some((statement) => {
      const condition = statement.Condition as Record<string, unknown> | undefined;
      const arn = condition?.ArnNotEquals as Record<string, unknown> | undefined;
      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
      return (
        statement.Effect === 'Deny' &&
        statement.Principal === '*' &&
        !statement.NotPrincipal &&
        !statement.NotAction &&
        !statement.NotResource &&
        protectedActions.every((action) => actions.includes(action)) &&
        resources.includes(`arn:aws:s3:::${bucket}/driver-documents/quarantine/*`) &&
        condition !== undefined &&
        Object.keys(condition).length === 1 &&
        arn !== undefined &&
        Object.keys(arn).length === 1 &&
        arn['aws:PrincipalArn'] === role
      );
    });
  } catch {
    return false;
  }
}

/** Reads trusted GuardDuty results; never downloads private document contents or initiates a paid scan. */
export class GuardDutyDocumentScanner implements DocumentScanner {
  private config: z.infer<typeof GuardDutyScanConfig>;
  private operations: ScanOperations;
  private client: S3Client | undefined;
  constructor(config: z.infer<typeof GuardDutyScanConfig>, operations?: ScanOperations) {
    this.config = GuardDutyScanConfig.parse(config);
    this.client = operations
      ? undefined
      : new S3Client({
          region: config.region,
          maxAttempts: 2,
          ignoreConfiguredEndpointUrls: true,
        });
    this.operations = operations ?? {
      policy: (signal) =>
        this.client!.send(
          new GetBucketPolicyCommand({
            Bucket: config.bucket,
            ExpectedBucketOwner: config.ownerAccountId,
          }),
          { abortSignal: signal },
        ),
      tags: (input, signal) => this.client!.send(new GetObjectTaggingCommand(input), { abortSignal: signal }),
    };
  }
  close() {
    this.client?.destroy();
  }
  async scan(target: ScanTarget, parent: AbortSignal) {
    const value = z
      .object({
        documentId: z.uuid(),
        key: z.string(),
        version: z.string().min(1).max(1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(target);
    const prefix = `driver-documents/quarantine/${value.documentId}/`;
    if (
      !value.key.startsWith(prefix) ||
      !z.uuid().safeParse(value.key.slice(prefix.length)).success ||
      value.version === 'null'
    )
      throw new DomainError('INVALID_DOCUMENT', 'Invalid immutable document reference.', 422);
    const signal = AbortSignal.any([parent, AbortSignal.timeout(10_000)]);
    try {
      signal.throwIfAborted();
      const policy = await this.operations.policy(signal);
      if (!policy.Policy || !protectsScanTags(policy.Policy, this.config.bucket, this.config.scannerRoleArn))
        throw new Error('Scan tag protection missing');
      const result = await this.operations.tags(
        {
          Bucket: this.config.bucket,
          ExpectedBucketOwner: this.config.ownerAccountId,
          Key: value.key,
          VersionId: value.version,
        },
        signal,
      );
      signal.throwIfAborted();
      const tags = result.TagSet?.filter((tag) => tag.Key === 'GuardDutyMalwareScanStatus');
      if (result.VersionId !== value.version || tags?.length !== 1) throw new Error('No verified result');
      const verdict =
        tags[0]?.Value === 'NO_THREATS_FOUND'
          ? 'clean'
          : tags[0]?.Value === 'THREATS_FOUND'
            ? 'infected'
            : undefined;
      if (!verdict) throw new Error('Scan incomplete or unsupported');
      return { ...value, verdict } as ScanTarget & { verdict: 'clean' | 'infected' };
    } catch {
      throw new DomainError('DOCUMENT_SCAN_UNAVAILABLE', 'Document scanning could not be verified.', 503);
    }
  }
}
