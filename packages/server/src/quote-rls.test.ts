import { bindActorIdentity } from './actor-transaction';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { createDatabase } from '@rove/database';
import { testDatabase } from '@rove/database/testing';
import { bindQuoteOwner, bindQuoteRide } from './quote-scope';
import { transaction } from './transactions';
let db: Awaited<ReturnType<typeof testDatabase>>;
let runtime: ReturnType<typeof createDatabase>;
let actor: string;
beforeAll(async () => {
  db = await testDatabase();
  const password = randomBytes(32).toString('hex');
  await db.pool.query(`CREATE ROLE rls_quote LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await db.pool.query('GRANT USAGE ON SCHEMA public TO rls_quote');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_quote');
  const connection = new URL(db.connectionString);
  connection.username = 'rls_quote';
  connection.password = password;
  runtime = createDatabase(connection.toString());
}, 60000);
afterAll(async () => {
  await runtime?.close();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  actor = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Synthetic','rider')",
    [actor],
  );
});
test('quotes are owner-scoped, immutable and unavailable after account disablement', async () => {
  const quote = randomUUID(),
    other = randomUUID();
  await db.pool.query("INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,'Other','rider')", [
    other,
  ]);
  await transaction(runtime.pool, async (c) => {
    await bindQuoteOwner(c, actor);
    await c.query(
      "INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now()+interval '2 minutes')",
      [quote, actor],
    );
    expect((await c.query('SELECT id FROM quotes FOR UPDATE')).rows).toEqual([{ id: quote }]);
    expect((await c.query('DELETE FROM quotes')).rowCount).toBe(0);
    await bindActorIdentity(c, { id: other, role: 'rider' });
    expect((await c.query('SELECT * FROM quotes')).rowCount).toBe(0);
  });
  expect((await runtime.pool.query('SELECT * FROM quotes')).rowCount).toBe(0);
  await transaction(runtime.pool, async (c) => {
    await bindQuoteOwner(c, other);
    expect((await c.query('SELECT * FROM quotes')).rowCount).toBe(0);
  });
  await expect(
    transaction(runtime.pool, async (c) => {
      await bindQuoteOwner(c, actor);
      await c.query("UPDATE quotes SET snapshot='{}'");
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    transaction(runtime.pool, async (c) => {
      await bindQuoteOwner(c, other);
      await c.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
        randomUUID(),
        actor,
      ]);
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [actor]);
  await transaction(runtime.pool, async (c) => {
    await bindQuoteOwner(c, actor);
    expect((await c.query('SELECT * FROM quotes')).rowCount).toBe(0);
  });
});
test('ride worker scope exposes only its associated quote and cannot mutate it', async () => {
  const quote = randomUUID(),
    foreign = randomUUID(),
    ride = randomUUID();
  for (const id of [quote, foreign])
    await db.pool.query("INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now())", [
      id,
      actor,
    ]);
  await db.pool.query(
    'INSERT INTO rides(id,quote_id,rider_id,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,1000,800,now())',
    [ride, quote, actor],
  );
  await transaction(runtime.pool, async (c) => {
    await bindQuoteRide(c, ride);
    expect((await c.query('SELECT id FROM quotes')).rows).toEqual([{ id: quote }]);
    expect((await c.query("UPDATE quotes SET snapshot='{}'")).rowCount).toBe(0);
    expect((await c.query('DELETE FROM quotes')).rowCount).toBe(0);
    await bindQuoteRide(c, randomUUID());
    expect((await c.query('SELECT * FROM quotes')).rowCount).toBe(0);
  });
  expect((await runtime.pool.query('SELECT * FROM quotes')).rowCount).toBe(0);
});
