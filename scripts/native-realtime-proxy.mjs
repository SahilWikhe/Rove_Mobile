import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';

// Local synthetic acceptance only. Record event types, never tokens or message content.
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { WebSocket, WebSocketServer } = require('ws');
const [listen = '8193', upstream = '8190'] = process.argv.slice(2);
if (![listen, upstream].every((p) => /^\d+$/.test(p) && +p >= 1024 && +p <= 65535) || +listen === +upstream)
  throw new Error('Provide distinct local proxy and API ports.');
const record = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
const server = createServer((req, res) => {
  const target = request(
    { hostname: '127.0.0.1', port: +upstream, path: req.url, method: req.method, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    },
  );
  target.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.on('aborted', () => target.destroy());
  req.pipe(target);
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
let sequence = 0;
let unavailableUntil = 0;
let recoveryTimer;
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/v1/realtime') return socket.destroy();
  if (Date.now() < unavailableUntil) {
    record({ type: 'fault-rejected-upgrade' });
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => {
    const connection = ++sequence;
    const target = new WebSocket(`ws://127.0.0.1:${upstream}/v1/realtime`);
    const pending = [];
    record({ connection, type: 'connected' });
    client.on('message', (data, binary) => {
      if (target.readyState === WebSocket.OPEN) target.send(data, { binary });
      else if (target.readyState === WebSocket.CONNECTING && pending.length < 16)
        pending.push([data, binary]);
      else client.close(1011);
    });
    target.on('open', () => {
      for (const [data, binary] of pending.splice(0)) target.send(data, { binary });
    });
    target.on('message', (data, binary) => {
      try {
        const { type } = JSON.parse(data.toString());
        if (['ready', 'messages.changed', 'driver.location.changed'].includes(type))
          record({ connection, type });
      } catch {
        /* Forward unchanged; this proxy does not validate application messages. */
      }
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
    target.on('close', () => {
      record({ connection, type: 'closed' });
      client.close();
    });
    client.on('close', () => target.close());
    target.on('error', () => client.close(1011));
    client.on('error', () => target.close());
  });
});
server.listen(+listen, '127.0.0.1', () => record({ type: 'listening', port: +listen }));
// Explicit local fault injection: drop sockets for eight seconds, preserving HTTPS fallback.
// Signal only the owned proxy PID; this handler is never installed in the application API.
process.on('SIGUSR1', () => {
  if (process.env.NATIVE_REALTIME_FAULTS !== '1') return;
  unavailableUntil = Date.now() + 8000;
  clearTimeout(recoveryTimer);
  record({ type: 'fault-started' });
  for (const client of wss.clients) client.terminate();
  recoveryTimer = setTimeout(() => record({ type: 'fault-ended' }), 8000);
});
const stop = () => {
  clearTimeout(recoveryTimer);
  for (const client of wss.clients) client.terminate();
  server.close();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
