import { z } from 'zod';

const HttpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  });
const Origin = HttpsUrl.refine((value) => new URL(value).origin === value);
const IntegerMoney = z.number().int().min(0).max(1_000_000);
const Rates = z
  .object({
    version: z.string().trim().min(1).max(100),
    baseCents: IntegerMoney,
    centsPerKilometer: IntegerMoney,
    centsPerMinute: IntegerMoney,
    minimumCents: IntegerMoney,
    driverBaseCents: IntegerMoney,
    driverCentsPerKilometer: IntegerMoney,
    driverCentsPerMinute: IntegerMoney,
    driverMinimumCents: IntegerMoney,
  })
  .strict();
const Area = z
  .object({
    south: z.number().min(-90).max(90),
    north: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    east: z.number().min(-180).max(180),
  })
  .strict()
  .refine((area) => area.south < area.north && area.west < area.east);
const DatabaseUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    // Explicit certificate verification; do not accept libpq's weaker SSL modes or overrides.
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      Boolean(url.hostname && url.username && url.password && url.pathname.length > 1) &&
      url.searchParams.getAll('sslmode').length === 1 &&
      url.searchParams.get('sslmode') === 'verify-full' &&
      [...url.searchParams.keys()].every((key) => key === 'sslmode')
    );
  });
const Schema = z.object({
  environment: z.enum(['preview', 'staging', 'production']),
  databaseUrl: DatabaseUrl,
  oidcIssuer: HttpsUrl,
  oidcAudience: z.string().trim().min(1).max(300),
  oidcJwksUrl: HttpsUrl,
  googleMapsApiKey: z.string().trim().min(1),
  allowedOrigins: z.array(Origin).max(20),
  rates: Rates,
  serviceArea: Area,
});
export type ApiConfig = z.infer<typeof Schema>;

/** Only field names escape parsing failures; Zod input and secret values never enter errors. */
export class ConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super('Invalid API configuration: ' + [...new Set(fields)].sort().join(', '));
    this.name = 'ConfigurationError';
  }
}
function json(value: string | undefined, field: string): unknown {
  try {
    return JSON.parse(value ?? 'null');
  } catch {
    throw new ConfigurationError([field]);
  }
}
/** Explicit environment input makes testing independent of ambient credentials. No defaults for pricing. */
export function readApiConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = Schema.safeParse({
    environment: env.ROVE_ENVIRONMENT,
    databaseUrl: env.DATABASE_URL,
    oidcIssuer: env.OIDC_ISSUER,
    oidcAudience: env.OIDC_AUDIENCE,
    oidcJwksUrl: env.OIDC_JWKS_URL,
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY,
    allowedOrigins: json(env.ALLOWED_ORIGINS_JSON ?? '[]', 'allowedOrigins'),
    rates: json(env.RATE_POLICY_JSON, 'rates'),
    serviceArea: json(env.SERVICE_AREA_JSON, 'serviceArea'),
  });
  if (!parsed.success)
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => String(issue.path[0] ?? 'configuration')),
    );
  const config = parsed.data;
  // Vercel previews must never accidentally select production configuration.
  if (
    env.VERCEL_ENV &&
    (env.VERCEL_ENV === 'preview'
      ? config.environment === 'production'
      : env.VERCEL_ENV === 'production' && config.environment === 'preview')
  )
    throw new ConfigurationError(['environment']);
  if (
    config.environment === 'production' &&
    (env.RATE_POLICY_APPROVED_VERSION !== config.rates.version ||
      /synthetic|fixture|test/i.test(config.rates.version))
  )
    throw new ConfigurationError(['rates']);
  if (env.EXPO_PUBLIC_SYNTHETIC === 'true' || env.ROVE_SYNTHETIC === 'true')
    throw new ConfigurationError(['syntheticMode']);
  return config;
}
