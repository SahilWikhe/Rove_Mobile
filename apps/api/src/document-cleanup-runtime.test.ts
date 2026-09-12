import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '@rove/database/testing';
import { users, drivers } from '@rove/database';
import {
  developmentRates,
  DriverDocumentService,
  AccountClosures,
  AccountDeletions,
  SupportService,
  type DocumentCleanupProvider,
  type Actor,
  type PaymentProvider,
  type PaymentCustomerProvider,
  type PaymentWebhookVerifier,
} from '@rove/server';
import { composeRuntime } from './runtime';
import { readRuntimeConfig } from './runtime-config';
let db: Awaited<ReturnType<typeof testDatabase>>, staff: Actor, driver: Actor, documentId: string;
const provider = {
  discover: vi.fn<DocumentCleanupProvider['discover']>(),
  erase: vi.fn<DocumentCleanupProvider['erase']>(),
};
function config(enabled = true) {
  return readRuntimeConfig({
    ROVE_ENVIRONMENT: 'staging',
    DATABASE_URL: 'postgresql://fixture:private@db.example.test/rove?sslmode=verify-full',
    OIDC_ISSUER: 'https://identity.example.test/',
    OIDC_AUDIENCE: 'rove-api',
    OIDC_JWKS_URL: 'https://identity.example.test/jwks',
    GOOGLE_MAPS_API_KEY: 'synthetic',
    RATE_POLICY_JSON: JSON.stringify(developmentRates),
    SERVICE_AREA_JSON: JSON.stringify({ south: 35, north: 37, west: -80, east: -77 }),
    STRIPE_ACCOUNT_ID: 'acct_fixture',
    STRIPE_MODE: 'test',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_PAYMENT_METHOD_CONFIGURATION: 'pmc_fixture',
    DOCUMENT_CLEANUP_ENABLED: String(enabled),
    DOCUMENT_CLEANUP_POLICY_REFERENCE: 'synthetic-policy',
    DOCUMENT_S3_BUCKET: 'synthetic-documents',
    DOCUMENT_S3_REGION: 'us-east-2',
    DOCUMENT_S3_OWNER_ACCOUNT_ID: '123456789012',
    DOCUMENT_CLEANUP_AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/cleanup',
  });
}
const unused = async () => {
  throw new Error('Unexpected provider call');
};
const payments: PaymentProvider & PaymentCustomerProvider & PaymentWebhookVerifier = {
  createCustomer: unused,
  create: unused,
  retrieve: unused,
  cancel: unused,
  capture: unused,
  refund: unused,
  session: unused,
  verifyWebhook: () => {
    throw new Error('Unexpected webhook');
  },
};
function resources() {
  return {
    database: db,
    maps: { search: async () => [], resolve: unused, route: unused },
    payments,
    verifyIdentity: async (subject: string) => ({
      subject: subject === 'staff-no-mfa' ? staff.id : subject,
      mfa: subject === staff.id,
    }),
  };
}
function request(
  app: ReturnType<typeof composeRuntime>['app'],
  path: string,
  body?: unknown,
  subject = staff.id,
  key = randomUUID(),
) {
  return app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + subject,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users,outbox CASCADE');
  staff = { id: randomUUID(), role: 'staff', mfa: true };
  driver = { id: randomUUID(), role: 'driver' };
  await db.db
    .insert(users)
    .values([staff, driver].map((a) => ({ id: a.id, role: a.role, subject: a.id, name: 'Synthetic' })));
  await db.db.insert(drivers).values({ id: driver.id });
  await db.pool.query(
    "INSERT INTO staff_permissions(staff_id,permission) VALUES($1,'privacy.close'),($1,'privacy.cleanup'),($1,'privacy.read')",
    [staff.id],
  );
  documentId = randomUUID();
  await new DriverDocumentService(db.pool).reserve(driver, {
    id: documentId,
    kind: 'driver_license',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    bytes: 100,
  });
  await new SupportService(db.pool).create(
    driver,
    { category: 'account', message: 'Delete synthetic account', deletionConsent: 'account-deletion-v1' },
    randomUUID(),
  );
  const deletion = (await new AccountDeletions(db.pool).status(driver)).request!;
  await new AccountClosures(
    db.pool,
    { erase: async () => ({ status: 'absent' }) },
    'synthetic-policy',
  ).authorize(
    staff,
    deletion.id,
    { policyReference: 'synthetic-policy', reviewReference: 'synthetic-review' },
    randomUUID(),
  );
  await db.pool.query("UPDATE driver_documents SET expires_at=now()-interval '1 second'");
  await db.pool.query('TRUNCATE outbox CASCADE');
  provider.discover.mockReset().mockResolvedValue([
    {
      documentId,
      key: `driver-documents/inbox/${documentId}/${randomUUID()}`,
      version: 'synthetic-version',
      kind: 'object',
    },
  ]);
  provider.erase.mockReset().mockResolvedValue({ status: 'absent' });
});
test('disabled routes cannot prepare work; enabled composition requires the dedicated provider', async () => {
  expect(() => composeRuntime(config(), resources())).toThrow('Document cleanup provider is required');
  const runtime = composeRuntime(config(false), { ...resources(), documentCleanup: provider });
  expect((await request(runtime.app, `/v1/staff/documents/${documentId}/cleanup-plans`, {})).status).toBe(
    503,
  );
  expect((await request(runtime.app, `/v1/staff/document-cleanup-plans/${randomUUID()}`)).status).toBe(503);
  expect(await runtime.worker.runOnce()).toEqual({ processed: 0, failed: 0 });
  expect(provider.discover).not.toHaveBeenCalled();
  expect(provider.erase).not.toHaveBeenCalled();
});
test('staff API prepares and approves exact versions, worker verifies removal, and replay does not delete twice', async () => {
  const runtime = composeRuntime(config(), { ...resources(), documentCleanup: provider });
  const path = `/v1/staff/documents/${documentId}/cleanup-plans`;
  expect((await runtime.app.request(path, { method: 'POST' })).status).toBe(401);
  expect((await request(runtime.app, path, {}, 'staff-no-mfa')).status).toBe(403);
  expect((await request(runtime.app, path, { key: 'foreign-key' })).status).toBe(400);
  const result = await request(runtime.app, path, {});
  expect(result.status).toBe(200);
  const plan = await result.json();
  expect(plan.state).toBe('draft');
  expect(provider.erase).not.toHaveBeenCalled();
  const planPath = `/v1/staff/document-cleanup-plans/${plan.id}`;
  const approval = {
    manifestHash: plan.manifestHash,
    policyReference: 'synthetic-policy',
    reviewReference: 'review',
    quiescenceReference: 'drained',
    notBefore: new Date(Date.now() - 1000).toISOString(),
  };
  expect(
    (await request(runtime.app, planPath + '/approve', { ...approval, manifestHash: 'b'.repeat(64) })).status,
  ).toBe(409);
  const key = randomUUID();
  expect((await request(runtime.app, planPath + '/approve', approval, staff.id, key)).status).toBe(200);
  expect(provider.erase).not.toHaveBeenCalled();
  provider.erase.mockRejectedValueOnce(new Error('Synthetic provider unavailable'));
  expect(await runtime.worker.runOnce()).toEqual({ processed: 0, failed: 1 });
  expect((await (await request(runtime.app, planPath)).json()).state).toBe('approved');
  await db.pool.query("UPDATE outbox SET dead_letter_at=now() WHERE topic='document.version-delete'");
  expect((await request(runtime.app, planPath + '/retry', {})).status).toBe(200);
  expect(await runtime.worker.runOnce()).toEqual({ processed: 1, failed: 0 });
  const entry = (await provider.discover.mock.results[0]!.value)[0]!;
  expect(provider.erase).toHaveBeenCalledWith({ documentId, key: entry.key, version: entry.version });
  expect((await (await request(runtime.app, planPath)).json()).state).toBe('versions_removed');
  expect((await request(runtime.app, planPath + '/approve', approval, staff.id, key)).status).toBe(200);
  expect((await request(runtime.app, planPath + '/retry', {})).status).toBe(200);
  expect(await runtime.worker.runOnce()).toEqual({ processed: 0, failed: 0 });
  expect(provider.erase).toHaveBeenCalledTimes(2);
});
