import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import type { MessageEvents } from './message-events';

const Authentication = z
  .object({ type: z.literal('authenticate'), token: z.string().min(1).max(12000) })
  .strict();
type Identity = { id: string; role: string };
export function attachMessageWebSocket(
  server: Server,
  options: {
    events: MessageEvents;
    authenticate: (token: string) => Promise<Identity | null>;
    allowedOrigins?: string[];
    lifetimeMs?: number;
    recheckMs?: number;
  },
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  const counts = new Map<string, number>();
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const origin = request.headers.origin;
    // React Native Android sends the API's own HTTP(S) origin automatically.
    const host = request.headers.host;
    const sameOrigin =
      origin === `https://${host}` ||
      ((host?.startsWith('127.0.0.1:') || host?.startsWith('localhost:')) && origin === `http://${host}`);
    if (
      !['/v1/realtime', '/api/realtime'].includes(url.pathname) ||
      url.search ||
      wss.clients.size >= 256 ||
      (origin && !sameOrigin && !options.allowedOrigins?.includes(origin))
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws) => {
    let identity: Identity | undefined;
    let unsubscribe: (() => void) | undefined;
    let authenticating = false,
      checking = false,
      alive = true,
      closed = false;
    let token = '';
    const send = (type: 'ready' | 'messages.changed') => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 32768) {
        ws.close(1013, 'Reconnect');
        return;
      }
      ws.send(JSON.stringify({ type }));
    };
    const authTimeout = setTimeout(() => ws.close(4401, 'Sign in required'), 10000);
    const lifetime = setTimeout(() => ws.close(1000, 'Reconnect'), options.lifetimeMs ?? 100000);
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 25000);
    const recheck = setInterval(() => {
      if (!identity || checking || closed) return;
      checking = true;
      void options
        .authenticate(token)
        .then((next) => {
          if (!next || next.id !== identity?.id || next.role !== identity?.role)
            ws.close(4401, 'Sign in required');
        })
        .catch(() => ws.close(1013, 'Reconnect'))
        .finally(() => {
          checking = false;
        });
    }, options.recheckMs ?? 30000);
    ws.on('pong', () => {
      alive = true;
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      closed = true;
      token = '';
      clearTimeout(authTimeout);
      clearTimeout(lifetime);
      clearInterval(heartbeat);
      clearInterval(recheck);
      unsubscribe?.();
      if (identity) {
        const count = (counts.get(identity.id) ?? 1) - 1;
        if (count) counts.set(identity.id, count);
        else counts.delete(identity.id);
      }
    });
    ws.on('message', (data, binary) => {
      if (identity || authenticating || binary) {
        ws.close(4400, 'Invalid request');
        return;
      }
      let input: z.infer<typeof Authentication>;
      try {
        input = Authentication.parse(JSON.parse(data.toString()));
      } catch {
        ws.close(4400, 'Invalid request');
        return;
      }
      authenticating = true;
      void (async () => {
        const actor = await options.authenticate(input.token);
        if (closed) return;
        if (!actor || !['rider', 'driver'].includes(actor.role) || (counts.get(actor.id) ?? 0) >= 4) {
          ws.close(4401, 'Sign in required');
          return;
        }
        identity = actor;
        token = input.token;
        counts.set(actor.id, (counts.get(actor.id) ?? 0) + 1);
        const stop = await options.events.subscribe(actor.id, {
          changed: () => send('messages.changed'),
          disconnected: () => ws.close(1013, 'Reconnect'),
        });
        if (closed) {
          stop();
          return;
        }
        unsubscribe = stop;
        clearTimeout(authTimeout);
        send('ready');
      })().catch(() => ws.close(1013, 'Reconnect'));
    });
  });
  let closing: Promise<void> | undefined;
  return {
    close: () =>
      (closing ??= (async () => {
        for (const client of wss.clients) client.terminate();
        options.events.disconnect();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
      })()),
  };
}
