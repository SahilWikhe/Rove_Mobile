import { z } from 'zod';
import { RideState } from '@rove/contracts';
const Operation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('book'), quoteId: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('transition'),
      rideId: z.uuid(),
      state: RideState,
      version: z.number().int().min(0),
    })
    .strict(),
]);
const Entry = z.object({ key: z.uuid(), operation: Operation }).strict();
export type Operation = z.infer<typeof Operation>;
export type PendingOperation = z.infer<typeof Entry>;
export interface OperationStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}
export class PendingOperationError extends Error {
  constructor() {
    super('Confirm the previous request before starting another action.');
  }
}
/** One serialized journal per account/API scope. Persist before any mutation leaves the device. */
export class OperationJournal {
  private queue: Promise<unknown> = Promise.resolve();
  private inFlight = new Map<string, Promise<unknown>>();
  constructor(
    private storage: OperationStorage,
    private key: () => string,
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async read(): Promise<PendingOperation | null> {
    const value = await this.storage.read();
    if (value === null) return null;
    try {
      return Entry.parse(JSON.parse(value));
    } catch {
      throw new Error('Stored request could not be read. Contact support before trying another action.');
    }
  }
  pending() {
    return this.serial(() => this.read());
  }
  execute<T>(input: Operation, send: (entry: PendingOperation) => Promise<T>): Promise<T> {
    const operation = Operation.parse(input);
    const fingerprint = JSON.stringify(operation);
    const existing = this.inFlight.get(fingerprint);
    if (existing) return existing as Promise<T>;
    const result = this.serial(async () => {
      let entry = await this.read();
      if (entry && JSON.stringify(entry.operation) !== JSON.stringify(operation))
        throw new PendingOperationError();
      if (!entry) {
        entry = Entry.parse({ key: this.key(), operation });
        await this.storage.write(JSON.stringify(entry));
      }
      let result: T;
      try {
        result = await send(entry);
      } catch (error) {
        const status = (error as { status?: unknown } | null)?.status;
        // Server validation/domain rejection is definitive. Network/auth/throttling/5xx are not.
        if (status === 400 || status === 404 || status === 409 || status === 422) await this.storage.clear();
        throw error;
      }
      await this.storage.clear();
      return result;
    });
    this.inFlight.set(fingerprint, result);
    void result.then(
      () => this.inFlight.delete(fingerprint),
      () => this.inFlight.delete(fingerprint),
    );
    return result;
  }
}
