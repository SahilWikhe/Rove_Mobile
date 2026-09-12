import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

const Event = z.object({ users: z.array(z.uuid().nullable()).max(10000) }).strict();
type Subscriber = {
  changed: (type: 'messages.changed' | 'driver.location.changed') => void;
  disconnected: () => void;
};
/** One session connection per active server instance; never transaction-pool LISTEN. */
export class MessageEvents {
  private listeners = new Map<string, Set<Subscriber>>();
  private client: PoolClient | undefined;
  private starting: Promise<void> | undefined;
  private generation = 0;
  constructor(private pool: Pool) {}
  private async start() {
    if (this.client) return;
    if (this.starting) return this.starting;
    const epoch = this.generation;
    this.starting = (async () => {
      const client = await this.pool.connect();
      const fail = () => {
        if (this.client === client || epoch === this.generation) this.disconnect();
      };
      client.on('error', fail);
      client.on('end', fail);
      client.on('notification', (notification) => {
        if (
          this.client !== client ||
          !['rove_messages_changed', 'rove_driver_location_changed'].includes(notification.channel)
        )
          return;
        try {
          const event = Event.parse(JSON.parse(notification.payload ?? ''));
          for (const id of new Set(event.users))
            if (id)
              for (const listener of this.listeners.get(id) ?? [])
                listener.changed(
                  notification.channel === 'rove_messages_changed'
                    ? 'messages.changed'
                    : 'driver.location.changed',
                );
        } catch {
          /* Invalid database notifications never enter a client connection. */
        }
      });
      try {
        const installed = await client.query(`SELECT count(*)::int AS count FROM pg_trigger
          WHERE tgfoid=to_regprocedure('public.rove_notify_messages()') AND NOT tgisinternal AND tgenabled<>'D'`);
        if (installed.rows[0]?.count !== 6) throw new Error('Realtime migration is not installed');
        const location = await client.query(
          `SELECT count(*)::int AS count FROM pg_trigger WHERE tgfoid=to_regprocedure('public.rove_notify_driver_location()') AND NOT tgisinternal AND tgenabled<>'D'`,
        );
        if (location.rows[0]?.count !== 1) throw new Error('Location realtime migration is not installed');
        await client.query('LISTEN rove_messages_changed');
        await client.query('LISTEN rove_driver_location_changed');
        if (epoch !== this.generation) {
          client.release(true);
          return;
        }
        this.client = client;
      } catch (error) {
        client.release(true);
        throw error;
      }
    })().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  async subscribe(id: string, subscriber: Subscriber) {
    // Register before LISTEN resolves; the ready event forces an authoritative catch-up.
    const set = this.listeners.get(id) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.listeners.set(id, set);
    try {
      await this.start();
      if (!this.client) throw new Error('Realtime unavailable');
    } catch (error) {
      set.delete(subscriber);
      if (!set.size) this.listeners.delete(id);
      throw error;
    }
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      set.delete(subscriber);
      if (!set.size) this.listeners.delete(id);
      if (!this.listeners.size) this.disconnect();
    };
  }
  disconnect() {
    this.generation++;
    const subscribers = [...this.listeners.values()].flatMap((set) => [...set]);
    this.listeners.clear();
    const client = this.client;
    this.client = undefined;
    if (client) client.release(true);
    for (const subscriber of subscribers) subscriber.disconnected();
  }
}
