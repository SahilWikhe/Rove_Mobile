import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { WebSocket, WebSocketServer } = require('ws');

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('local proxy constrains HTTP forwarding and preserves realtime frames', { timeout: 15000 }, async () => {
  const seen = [];
  const upstream = createServer((req, res) => {
    seen.push({ path: req.url, headers: req.headers });
    if (req.url === '/redirect') {
      res.writeHead(302, {
        location: 'https://external.example.test/',
        refresh: '0;url=https://external.example.test/',
      });
      res.end();
      return;
    }
    res.setHeader('constructor', 'untrusted');
    res.setHeader('__proto__', 'untrusted');
    res.setHeader('set-cookie', 'unexpected=yes');
    res.setHeader('content-type', 'application/json');
    res.setHeader('retry-after', '2');
    res.end('{"ok":true}');
  });
  const sockets = new WebSocketServer({ server: upstream, path: '/v1/realtime' });
  sockets.on('connection', (socket) => socket.on('message', (data, binary) => socket.send(data, { binary })));
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamPort = upstream.address().port;
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(
    process.execPath,
    [new URL('./native-realtime-proxy.mjs', import.meta.url).pathname, String(port), String(upstreamPort)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = once(child, 'exit');
  let ready = false;
  child.stdout.on('data', (chunk) => {
    if (chunk.toString().includes('"type":"listening"')) ready = true;
  });
  let client;
  try {
    for (let i = 0; i < 100 && !ready; i++) {
      assert.equal(child.exitCode, null);
      await delay(20);
    }
    assert(ready);
    const result = await get(port, '/v1/me?check=1', {
      authorization: 'Bearer synthetic',
      'idempotency-key': 'synthetic-key',
      host: 'external.example.test',
      'x-untrusted': 'drop',
    });
    assert.equal(result.status, 200);
    assert.equal(result.body, '{"ok":true}');
    assert.equal(result.headers['retry-after'], '2');
    for (const name of ['constructor', '__proto__', 'set-cookie'])
      assert.equal(Object.hasOwn(result.headers, name), false);
    assert.equal(seen[0].headers.authorization, 'Bearer synthetic');
    assert.equal(seen[0].headers['idempotency-key'], 'synthetic-key');
    assert.equal(seen[0].headers.host, `127.0.0.1:${upstreamPort}`);
    assert.equal(seen[0].headers['x-untrusted'], undefined);
    const redirect = await get(port, '/redirect');
    assert.equal(redirect.status, 502);
    assert.equal(redirect.headers.location, undefined);
    assert.equal(redirect.headers.refresh, undefined);
    const count = seen.length;
    for (const path of [
      'http://external.example.test/',
      '//external.example.test/',
      '/\\external.example.test/',
    ])
      assert.equal((await get(port, path)).status, 400);
    assert.equal(seen.length, count);
    client = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime`);
    await once(client, 'open');
    const received = once(client, 'message');
    client.send('{"type":"synthetic-check"}');
    assert.equal((await received)[0].toString(), '{"type":"synthetic-check"}');
    client.close();
    await once(client, 'close');
  } finally {
    client?.terminate();
    child.kill('SIGTERM');
    await exited;
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});
