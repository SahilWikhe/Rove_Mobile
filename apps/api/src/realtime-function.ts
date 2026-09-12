import { readApiConfig } from './config';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import app from '../index';
import { MessageEvents } from './message-events';
import { attachMessageWebSocket } from './message-websocket';
import { realtimeDatabaseUrl } from './realtime-config';

const url = realtimeDatabaseUrl(process.env);
const server = createServer((_request, response) => {
  response.writeHead(url ? 426 : 503, { 'Cache-Control': 'no-store' });
  response.end();
});
if (url) {
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 1000,
  });
  attachMessageWebSocket(server, {
    events: new MessageEvents(pool),
    // Same JWT, verification, disabled-account and request-limit checks as HTTPS.
    authenticate: async (token) => {
      const response = await app.request('/v1/me', { headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) return null;
      return response.json();
    },
    allowedOrigins: readApiConfig(process.env).allowedOrigins,
  });
} else
  server.on('upgrade', (_request, socket) =>
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'),
  );
export default server;
