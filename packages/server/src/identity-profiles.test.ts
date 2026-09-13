import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { findVerifiedProfile, registerVerifiedProfile } from './identity-profiles';
let runtime: Pool;
let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  database = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await database.pool.query(
    `CREATE ROLE identity_profile_probe LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
  );
  await database.pool.query(
    'GRANT USAGE ON SCHEMA public TO identity_profile_probe; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO identity_profile_probe',
  );
  const connection = new URL(database.connectionString);
  connection.username = 'identity_profile_probe';
  connection.password = password;
  runtime = new Pool({ connectionString: connection.toString() });
});
afterAll(async () => {
  await runtime?.end();
  await database?.close();
});
const subject = () => `synthetic-identity:${randomUUID()}`;

test('concurrent signup retries preserve the original role and create one unapproved driver', async () => {
  const sub = subject();
  const profiles = await Promise.all(
    Array.from({ length: 4 }, () =>
      registerVerifiedProfile(runtime, sub, { name: 'Driver', role: 'driver' }),
    ),
  );
  expect(new Set(profiles.map((p) => p.id)).size).toBe(1);
  expect(await registerVerifiedProfile(runtime, sub, { name: 'Changed', role: 'rider' })).toEqual(
    profiles[0],
  );
  expect(
    (
      await database.pool.query('SELECT approved,online,payout_ready FROM drivers WHERE id=$1', [
        profiles[0]!.id,
      ])
    ).rows,
  ).toEqual([{ approved: false, online: false, payout_ready: false }]);
  expect(await findVerifiedProfile(runtime, subject())).toBeUndefined();
  expect(await findVerifiedProfile(runtime, sub)).toMatchObject({ ...profiles[0], disabled: false });
});

test('disabled accounts stay visible to the verifier and cannot be reactivated by signup', async () => {
  const sub = subject();
  const user = await registerVerifiedProfile(runtime, sub, { name: 'Rider', role: 'rider' });
  await database.pool.query('UPDATE users SET disabled=true WHERE id=$1', [user.id]);
  expect(await findVerifiedProfile(runtime, sub)).toMatchObject({ id: user.id, disabled: true });
  await expect(
    registerVerifiedProfile(runtime, sub, { name: 'Retry', role: 'driver' }),
  ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  await expect(
    registerVerifiedProfile(runtime, subject(), { name: 'Staff', role: 'staff' }),
  ).rejects.toThrow();
});

test('driver creation failure rolls back the user and permits a clean signup retry', async () => {
  const sub = subject();
  await database.pool
    .query(`CREATE FUNCTION fixture_signup_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic driver failure'; END $$;
    CREATE TRIGGER fixture_signup_failure BEFORE INSERT ON drivers FOR EACH ROW EXECUTE FUNCTION fixture_signup_failure()`);
  try {
    await expect(registerVerifiedProfile(runtime, sub, { name: 'Driver', role: 'driver' })).rejects.toThrow(
      'synthetic driver failure',
    );
    expect(await findVerifiedProfile(runtime, sub)).toBeUndefined();
  } finally {
    await database.pool.query(
      'DROP TRIGGER fixture_signup_failure ON drivers; DROP FUNCTION fixture_signup_failure()',
    );
  }
  expect(await registerVerifiedProfile(runtime, sub, { name: 'Driver', role: 'driver' })).toMatchObject({
    role: 'driver',
  });
  expect(
    (
      await database.pool.query(
        "SELECT NULLIF(current_setting('rove.identity_subject',true),'') AS subject,NULLIF(current_setting('rove.identity_signup',true),'') AS signup",
      )
    ).rows[0],
  ).toEqual({ subject: null, signup: null });
});
