import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { MessageRealtime } from './message-realtime';
class FakeSocket {
  onopen: WebSocket['onopen'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onclose: WebSocket['onclose'] = null;
  onerror: WebSocket['onerror'] = null;
  send = vi.fn();
  close = vi.fn();
  emit(type: 'open' | 'close' | 'message', data?: string) {
    const event = { data };
    (this[('on' + type) as 'onopen'] as ((event: unknown) => void) | null)?.(event);
  }
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
test('shares one socket, authenticates outside URL, refreshes on ready and ignores stale events after cleanup', async () => {
  const sockets: FakeSocket[] = [],
    urls: string[] = [];
  const stream = new MessageRealtime(
    'https://api.example.test',
    async () => 'synthetic-token',
    (url) => {
      urls.push(url);
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  );
  const changed = vi.fn(),
    connection = vi.fn();
  const stop1 = stream.subscribe({ changed, connection }),
    stop2 = stream.subscribe({ changed: vi.fn(), connection: vi.fn() });
  expect(sockets).toHaveLength(1);
  expect(urls).toEqual(['wss://api.example.test/v1/realtime']);
  const socket = sockets[0]!;
  socket.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'authenticate', token: 'synthetic-token' }),
  );
  socket.emit('message', '{"type":"ready"}');
  socket.emit('message', '{"type":"messages.changed"}');
  expect(changed).toHaveBeenCalledTimes(2);
  expect(connection).toHaveBeenLastCalledWith(true);
  stop1();
  expect(socket.close).not.toHaveBeenCalled();
  stop2();
  expect(socket.close).toHaveBeenCalledOnce();
  socket.emit('message', '{"type":"messages.changed"}');
  socket.emit('close');
  await vi.advanceTimersByTimeAsync(60000);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(sockets).toHaveLength(1);
});
test('reconnect uses a fresh token and ready forces catch-up; a missing handshake retries', async () => {
  const sockets: FakeSocket[] = [];
  const token = vi.fn().mockResolvedValueOnce('first').mockResolvedValue('refreshed');
  const stream = new MessageRealtime('http://localhost:4085', token, () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  });
  const changed = vi.fn();
  const stop = stream.subscribe({ changed, connection: vi.fn() });
  sockets[0]!.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  sockets[0]!.emit('close');
  await vi.advanceTimersByTimeAsync(1500);
  expect(sockets).toHaveLength(2);
  sockets[1]!.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  expect(token).toHaveBeenCalledTimes(2);
  sockets[1]!.emit('message', '{"type":"ready"}');
  expect(changed).toHaveBeenCalledOnce();
  sockets[1]!.emit('close');
  await vi.advanceTimersByTimeAsync(1500);
  expect(sockets).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(17500);
  expect(sockets.length).toBeGreaterThanOrEqual(4);
  stop();
});

test('location subscriptions share the socket but only stop fallback when the server supports location events', async () => {
  const sockets: FakeSocket[] = [];
  const stream = new MessageRealtime(
    'http://localhost:4085',
    async () => 'test',
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  );
  const location = vi.fn(),
    connection = vi.fn(),
    message = vi.fn();
  const stop = stream.subscribe({ topic: 'location', changed: location, connection });
  const stopMessages = stream.subscribe({ changed: message, connection: vi.fn() });
  sockets[0]!.emit('message', '{"type":"ready"}');
  expect(connection).toHaveBeenLastCalledWith(false);
  sockets[0]!.emit('message', '{"type":"ready","capabilities":["driver-location"]}');
  expect(connection).toHaveBeenLastCalledWith(true);
  location.mockClear();
  message.mockClear();
  sockets[0]!.emit('message', '{"type":"driver.location.changed"}');
  expect(location).toHaveBeenCalledOnce();
  expect(message).not.toHaveBeenCalled();
  sockets[0]!.emit('message', '{"type":"messages.changed"}');
  expect(location).toHaveBeenCalledTimes(2);
  expect(message).toHaveBeenCalledOnce();
  stop();
  stopMessages();
});
