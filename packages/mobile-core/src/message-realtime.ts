type Listener = {
  topic?: 'messages' | 'location';
  changed: () => void;
  connection: (connected: boolean) => void;
};
type Socket = Pick<WebSocket, 'send' | 'close' | 'onopen' | 'onmessage' | 'onclose' | 'onerror'>;
/** A shared account connection. Only invalidations travel over the socket, never message bodies. */
export class MessageRealtime {
  private listeners = new Set<Listener>();
  private socket: Socket | undefined;
  private timer?: ReturnType<typeof setTimeout>;
  private handshake?: ReturnType<typeof setTimeout>;
  private ready = false;
  private locationReady = false;
  private retry = 1000;
  private generation = 0;
  constructor(
    private baseUrl: string,
    private token: () => Promise<string | null>,
    private factory: (url: string) => Socket = (url) => new WebSocket(url),
  ) {}
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener.connection(listener.topic === 'location' ? this.ready && this.locationReady : this.ready);
    if (this.listeners.size === 1) this.connect();
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  }
  private connected(value: boolean) {
    this.ready = value;
    for (const listener of this.listeners)
      listener.connection(value && (listener.topic !== 'location' || this.locationReady));
  }
  private connect() {
    if (!this.listeners.size) return;
    const epoch = ++this.generation;
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/v1/realtime';
    url.search = '';
    url.hash = '';
    let socket: Socket;
    const reconnect = () => {
      if (epoch !== this.generation) return;
      this.generation++;
      clearTimeout(this.handshake);
      this.socket = undefined;
      socket?.close();
      this.connected(false);
      if (!this.listeners.size) return;
      const delay = this.retry + Math.floor(Math.random() * 500);
      this.retry = Math.min(this.retry * 2, 30000);
      this.timer = setTimeout(() => this.connect(), delay);
    };
    try {
      socket = this.factory(url.toString());
      this.socket = socket;
    } catch {
      reconnect();
      return;
    }
    this.handshake = setTimeout(reconnect, 15000);
    socket.onopen = () => {
      void this.token()
        .then((token) => {
          if (epoch !== this.generation) return;
          if (!token) {
            reconnect();
            return;
          }
          socket.send(JSON.stringify({ type: 'authenticate', token }));
        })
        .catch(reconnect);
    };
    socket.onmessage = (event) => {
      if (epoch !== this.generation || typeof event.data !== 'string' || event.data.length > 256) return;
      try {
        const value = JSON.parse(event.data);
        if (value.type === 'ready') {
          clearTimeout(this.handshake);
          this.retry = 1000;
          this.locationReady =
            Array.isArray(value.capabilities) && value.capabilities.includes('driver-location');
          this.connected(true);
          // Every new connection catches up from durable storage, including first connect.
          for (const listener of this.listeners) listener.changed();
        } else if (this.ready && ['messages.changed', 'driver.location.changed'].includes(value.type)) {
          for (const listener of this.listeners) {
            // Ride/assignment changes invalidate locations too, including revocation.
            if (value.type === 'messages.changed' || listener.topic === 'location') listener.changed();
          }
        }
      } catch {
        /* Ignore malformed non-authoritative notifications. */
      }
    };
    socket.onclose = reconnect;
    socket.onerror = reconnect;
  }
  private stop() {
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.handshake);
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    this.locationReady = false;
    this.retry = 1000;
    socket?.close();
  }
}
