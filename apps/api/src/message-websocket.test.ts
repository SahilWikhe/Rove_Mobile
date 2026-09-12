import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { MessagingService, type Actor } from '@rove/server';
import { MessageEvents } from './message-events';
import { attachMessageWebSocket } from './message-websocket';

let db: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  db = await testDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});
async function host() {
  const server = createServer();
  const events = new MessageEvents(db.pool);
  const realtime = attachMessageWebSocket(server, {
    events,
    recheckMs: 100,
    authenticate: async (token) => {
      const row = (
        await db.pool.query('SELECT id,role FROM users WHERE subject=$1 AND disabled=false', [token])
      ).rows[0];
      return row ?? null;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error();
  return {
    url: `ws://127.0.0.1:${address.port}/v1/realtime`,
    events,
    close: async () => {
      await realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
async function connect(url: string, actor: Actor) {
  const ws = new WebSocket(url, { origin: url.replace('ws:', 'http:').replace('/v1/realtime', '') });
  const messages: string[] = [];
  ws.on('message', (data) => messages.push(data.toString()));
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'authenticate', token: actor.id }));
  await expect.poll(() => messages).toContain('{"type":"ready","capabilities":["driver-location"]}');
  return { ws, messages };
}
async function fixture() {
  const rider: Actor = { id: randomUUID(), role: 'rider' },
    driver: Actor = { id: randomUUID(), role: 'driver' };
  const outsider: Actor = { id: randomUUID(), role: 'rider' };
  for (const actor of [rider, driver, outsider])
    await db.pool.query('INSERT INTO users(id,subject,name,role) VALUES($1::uuid,$1::text,$2,$3)', [
      actor.id,
      'Synthetic socket test',
      actor.role,
    ]);
  await db.pool.query('INSERT INTO drivers(id) VALUES($1)', [driver.id]);
  const quote = randomUUID(),
    ride = randomUUID(),
    offer = randomUUID();
  await db.pool.query(
    "INSERT INTO quotes(id,rider_id,snapshot,expires_at) VALUES($1,$2,'{}',now()+interval '1 hour')",
    [quote, rider.id],
  );
  await db.pool.query(
    "INSERT INTO rides(id,quote_id,rider_id,driver_id,state,fare_cents,earnings_cents,search_deadline) VALUES($1,$2,$3,$4,'matched',0,0,now())",
    [ride, quote, rider.id, driver.id],
  );
  await db.pool.query(
    "INSERT INTO offers(id,ride_id,driver_id,status,expires_at,snapshot) VALUES($1,$2,$3,'accepted',now(),'{}')",
    [offer, ride, driver.id],
  );
  return { rider, driver, outsider, ride, offer };
}
test('separate WebSocket instances deliver committed messages only to participants and recover missed history', async () => {
  const f = await fixture(),
    a = await host(),
    b = await host();
  const service = new MessagingService(db.pool);
  try {
    const rider = await connect(a.url, f.rider),
      driver = await connect(b.url, f.driver),
      outsider = await connect(a.url, f.outsider);
    const pending = await db.pool.connect();
    await pending.query('BEGIN');
    await pending.query('INSERT INTO trip_messages(offer_id,sender_id,request_id,text) VALUES($1,$2,$3,$4)', [
      f.offer,
      f.rider.id,
      randomUUID(),
      'Uncommitted text',
    ]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(driver.messages).toHaveLength(1);
    await pending.query('ROLLBACK');
    pending.release();
    const request = { text: 'Waiting at the entrance', requestId: randomUUID() };
    const sent = await service.send(f.rider, f.offer, request);
    await expect.poll(() => driver.messages.length).toBe(2);
    await expect.poll(() => rider.messages.length).toBe(2);
    expect(outsider.messages).toEqual(['{"type":"ready","capabilities":["driver-location"]}']);
    expect(driver.messages[1]).toBe('{"type":"messages.changed"}');
    expect((await service.thread(f.driver, f.offer)).messages[0]).toMatchObject({
      text: request.text,
      mine: false,
    });
    await service.send(f.rider, f.offer, request);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(driver.messages).toHaveLength(2);
    const disconnected = once(driver.ws, 'close');
    driver.ws.close();
    await disconnected;
    await service.send(f.rider, f.offer, {
      text: 'Second message while disconnected',
      requestId: randomUUID(),
    });
    const restored = await connect(b.url, f.driver);
    expect((await service.thread(f.driver, f.offer)).messages).toHaveLength(2);
    await service.read(f.driver, f.offer, { through: sent.sequence });
    await expect.poll(() => restored.messages.length).toBe(2);
    await service.report(f.rider, f.offer, { reason: 'other' });
    await expect.poll(() => restored.messages.length).toBe(3);
    expect((await service.thread(f.driver, f.offer)).conversation.canSend).toBe(false);
    const closed = once(restored.ws, 'close');
    await db.pool.query('UPDATE users SET disabled=true WHERE id=$1', [f.driver.id]);
    expect((await closed)[0]).toBe(4401);
  } finally {
    await a.close();
    await b.close();
  }
}, 20000);
test('unauthenticated, query-token and untrusted browser connections are rejected', async () => {
  const server = await host();
  try {
    const socket = new WebSocket(server.url);
    await once(socket, 'open');
    const closed = once(socket, 'close');
    socket.send(JSON.stringify({ type: 'authenticate', token: 'forged' }));
    expect((await closed)[0]).toBe(4401);
    for (const ws of [
      new WebSocket(server.url + '?token=forged'),
      new WebSocket(server.url, { origin: 'https://untrusted.example' }),
    ]) {
      ws.on('error', () => {});
      const [, response] = await once(ws, 'unexpected-response');
      // Reject at HTTP upgrade, before any authenticated stream exists.
      expect(response.statusCode).toBe(403);
      ws.terminate();
    }
  } finally {
    await server.close();
  }
});
test('loss of the database listener closes clients instead of pretending realtime is healthy', async () => {
  const f = await fixture(),
    server = await host();
  try {
    const client = await connect(server.url, f.rider);
    const closed = once(client.ws, 'close');
    server.events.disconnect();
    expect((await closed)[0]).toBe(1013);
  } finally {
    await server.close();
  }
});

test('missing notification triggers cannot produce a healthy ready connection', async () => {
  const f = await fixture(),
    server = await host();
  try {
    await db.pool.query('ALTER TABLE trip_message_reads DISABLE TRIGGER message_read_notify');
    const ws = new WebSocket(server.url);
    const messages: string[] = [];
    ws.on('message', (data) => messages.push(data.toString()));
    await once(ws, 'open');
    const closed = once(ws, 'close');
    ws.send(JSON.stringify({ type: 'authenticate', token: f.rider.id }));
    expect((await closed)[0]).toBe(1013);
    expect(messages).toEqual([]);
  } finally {
    await db.pool.query('ALTER TABLE trip_message_reads ENABLE TRIGGER message_read_notify');
    await server.close();
  }
});

test('committed driver movement pushes only to its assigned rider, without coordinates, and stops after completion', async () => {
  const f = await fixture(),
    a = await host(),
    b = await host();
  try {
    const rider = await connect(a.url, f.rider),
      outsider = await connect(b.url, f.outsider),
      driver = await connect(b.url, f.driver);
    const pending = await db.pool.connect();
    try {
      await pending.query('BEGIN');
      await pending.query('UPDATE drivers SET location=$2,location_sampled_at=now() WHERE id=$1', [
        f.driver.id,
        { latitude: 35.8, longitude: -78.6 },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(rider.messages).toHaveLength(1);
      await pending.query('ROLLBACK');
    } finally {
      pending.release();
    }
    for (const state of ['en_route', 'in_progress']) {
      await db.pool.query('UPDATE rides SET state=$2 WHERE id=$1', [f.ride, state]);
      const before = rider.messages.filter((x) => JSON.parse(x).type === 'driver.location.changed').length;
      await db.pool.query(
        'UPDATE drivers SET location=$2,location_sampled_at=clock_timestamp() WHERE id=$1',
        [f.driver.id, { latitude: state === 'en_route' ? 35.81 : 35.82, longitude: -78.6 }],
      );
      await expect
        .poll(() => rider.messages.filter((x) => JSON.parse(x).type === 'driver.location.changed').length)
        .toBe(before + 1);
    }
    expect(outsider.messages).toHaveLength(1);
    expect(driver.messages.filter((x) => JSON.parse(x).type === 'driver.location.changed')).toHaveLength(0);
    expect(rider.messages.filter((x) => JSON.parse(x).type === 'driver.location.changed')).toEqual([
      '{"type":"driver.location.changed"}',
      '{"type":"driver.location.changed"}',
    ]);
    await db.pool.query("UPDATE rides SET state='completed' WHERE id=$1", [f.ride]);
    await db.pool.query('UPDATE drivers SET location_sampled_at=clock_timestamp() WHERE id=$1', [
      f.driver.id,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rider.messages.filter((x) => JSON.parse(x).type === 'driver.location.changed')).toHaveLength(2);
  } finally {
    await a.close();
    await b.close();
  }
});
