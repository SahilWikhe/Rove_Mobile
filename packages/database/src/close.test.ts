import { expect, test } from 'vitest';
import { createDatabase } from './index';
import { testDatabase } from './testing';

test('close drains every established connection and is safe to call twice', async () => {
  const fixture = await testDatabase();
  const database = createDatabase(fixture.connectionString);
  let live = 0;
  database.pool.on('connect', (client) => {
    live++;
    client.once('end', () => {
      live--;
    });
  });
  try {
    await Promise.all(Array.from({ length: 5 }, () => database.pool.query('SELECT pg_sleep(0.02)')));
    expect(live).toBe(5);
    await Promise.all([database.close(), database.close()]);
    expect(live).toBe(0);
  } finally {
    await database.close();
    await fixture.close();
  }
}, 60_000);
