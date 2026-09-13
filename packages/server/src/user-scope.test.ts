import { bindActorIdentity } from './actor-transaction';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { bindUserRead } from './user-scope';
import { updateProfileName } from './profiles';
import { transaction } from './transactions';
let database: Awaited<ReturnType<typeof testDatabase>>;
let runtime: Pool;
const actor = { id: randomUUID(), role: 'rider' as const };
const other = randomUUID();
beforeAll(async () => {
  database = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await database.pool.query(
    `CREATE ROLE user_scope_probe LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
  );
  await database.pool.query(
    'GRANT USAGE ON SCHEMA public TO user_scope_probe; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO user_scope_probe',
  );
  for (const id of [actor.id, other])
    await database.pool.query("INSERT INTO users(id,subject,name,role) VALUES($1,$2,'Original','rider')", [
      id,
      `synthetic-user:${id}`,
    ]);
  const connection = new URL(database.connectionString);
  connection.username = 'user_scope_probe';
  connection.password = password;
  runtime = new Pool({ connectionString: connection.toString(), max: 1 });
});
afterAll(async () => {
  await runtime?.end();
  await database?.close();
});
test('exact account scope allows locks but denies unscoped reads, foreign reads and mutations', async () => {
  expect((await runtime.query('SELECT id FROM users')).rowCount).toBe(0);
  await transaction(runtime, async (c) => {
    await bindUserRead(c, actor.id);
    expect((await c.query('SELECT id FROM users FOR SHARE')).rows).toEqual([{ id: actor.id }]);
    expect((await c.query('SELECT id FROM users WHERE id=$1', [other])).rowCount).toBe(0);
  });
  await expect(
    transaction(runtime, async (c) => {
      await bindUserRead(c, actor.id);
      await c.query("UPDATE users SET role='staff'");
    }),
  ).rejects.toMatchObject({ code: '42501' });
  expect((await runtime.query('SELECT id FROM users')).rowCount).toBe(0);
});
test('profile writes permit the chosen name only and scope replacement revokes write authority', async () => {
  expect(
    await updateProfileName(runtime, actor, {
      expectedProfileId: actor.id,
      expectedName: 'Original',
      name: 'Updated',
    }),
  ).toMatchObject({ id: actor.id, name: 'Updated' });
  await expect(
    updateProfileName(runtime, actor, {
      expectedProfileId: actor.id,
      expectedName: 'Original',
      name: 'Stale',
    }),
  ).rejects.toMatchObject({ code: 'PROFILE_CHANGED' });
  for (const assignment of ["role='staff'", 'disabled=true', "subject='forged'", `id='${other}'`]) {
    await expect(
      transaction(runtime, async (c) => {
        await bindUserRead(c, actor.id);
        await c.query(
          "SELECT set_config('rove.user_profile_write',(to_jsonb(u)||jsonb_build_object('name','Intended'))::text,true) FROM users u WHERE id=$1",
          [actor.id],
        );
        await c.query(`UPDATE users SET ${assignment} WHERE id=$1`, [actor.id]);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  }
  await expect(
    transaction(runtime, async (c) => {
      await bindUserRead(c, actor.id);
      await c.query(
        "SELECT set_config('rove.user_profile_write',to_jsonb(u)::text,true) FROM users u WHERE id=$1",
        [actor.id],
      );
      await bindUserRead(c, other);
      await c.query("UPDATE users SET name='Forbidden'");
    }),
  ).rejects.toMatchObject({ code: '42501' });
});

test('actor rebinding clears identity and closure authority before reading the account', async () => {
  await transaction(runtime, async (c) => {
    await c.query(
      "SELECT set_config('rove.identity_subject','synthetic-other',true),set_config('rove.identity_signup','{}',true),set_config('rove.user_close_write','{}',true)",
    );
    await bindActorIdentity(c, actor);
    expect(
      (
        await c.query(
          "SELECT NULLIF(current_setting('rove.identity_subject',true),'') AS subject,NULLIF(current_setting('rove.identity_signup',true),'') AS signup,NULLIF(current_setting('rove.user_close_write',true),'') AS closure",
        )
      ).rows[0],
    ).toEqual({ subject: null, signup: null, closure: null });
    expect((await c.query('SELECT id FROM users')).rows).toEqual([{ id: actor.id }]);
  });
  expect((await runtime.query('SELECT id FROM users')).rowCount).toBe(0);
});
