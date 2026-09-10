import { z } from 'zod';
/** Non-secret server configuration; AWS credentials come from the SDK credential provider. */
export const S3DocumentConfig = z
  .object({
    bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
    region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
    ownerAccountId: z.string().regex(/^\d{12}$/),
  })
  .strict();
