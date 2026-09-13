import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { WebSocket, WebSocketServer } = require('ws');
const script = new URL('./native-realtime-proxy.mjs', import.meta.url);

test(
  'forwards HTTP and WebSocket traffic while recording only allowed event types',
  { timeout: 10000 },
  async () => {
    const upstream = createServer((req, res) => {
      assert.equal(req.headers.authorization, 'Bearer test-secret');
      res.writeHead(201, { 'Content-Type': 'text/plain' });
      req.pipe(res);
    });
    const wss = new WebSocketServer({ server: upstream, path: '/v1/realtime' });
    wss.on('connection', (socket) =>
      socket.on('message', () => {
        socket.send(JSON.stringify({ type: 'ready' }));
        socket.send(JSON.stringify({ type: 'messages.changed' }));
        socket.send(JSON.stringify({ type: 'private-test', text: 'private-content' }));
      }),
    );
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(process.execPath, [script.pathname, String(port), String(upstream.address().port)]);
    let output = '';
    let eventObserved;
    const recordedEvent = new Promise((resolve) => {
      eventObserved = resolve;
    });
    let client;
    try {
      await new Promise((resolve, reject) => {
        child.stdout.on('data', (data) => {
          output += data;
          if (output.includes('messages.changed')) eventObserved();
          if (output.includes('listening')) resolve();
        });
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code !== 0) reject(new Error(`Proxy exited ${code}`));
        });
      });
      const response = await fetch(`http://127.0.0.1:${port}/v1/test`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-secret' },
        body: 'private-content',
      });
      assert.equal(response.status, 201);
      assert.equal(await response.text(), 'private-content');
      client = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime`);
      const received = [];
      const complete = new Promise((resolve) =>
        client.on('message', (data) => {
          received.push(JSON.parse(data));
          if (received.length === 3) resolve();
        }),
      );
      await once(client, 'open');
      client.send('test-secret');
      await complete;
      assert.deepEqual(
        received.map((m) => m.type),
        ['ready', 'messages.changed', 'private-test'],
      );
      // stdout can arrive just after the network frame.
      await recordedEvent;
      assert.match(output, /messages.changed/);
      assert.doesNotMatch(output, /test-secret|private-content|private-test/);
    } finally {
      client?.terminate();
      child.kill('SIGTERM');
      for (const socket of wss.clients) socket.terminate();
      wss.close();
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
    }
  },
);
test('rejects equal or invalid ports', () => {
  for (const args of [
    ['8190', '8190'],
    ['08190', '8190'],
    ['0', '8190'],
    ['8193', 'not-a-port'],
  ]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
});
