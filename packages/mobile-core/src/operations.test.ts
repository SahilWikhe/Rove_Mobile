import { expect, test, vi } from 'vitest';
import { OperationJournal, PendingOperationError, type OperationStorage } from './operations';
const operation = { kind: 'book' as const, quoteId: '00000000-0000-4000-8000-000000000001' };
const key = '00000000-0000-4000-8000-000000000002';
function fixture() {
  let value: string | null = null;
  const storage: OperationStorage = {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    clear: async () => {
      value = null;
    },
  };
  return { storage, journal: new OperationJournal(storage, () => key) };
}
test('persists before sending and reuses exact payload/key after process restart', async () => {
  const { storage, journal } = fixture();
  const first = vi.fn(async () => {
    expect(await storage.read()).toContain(key);
    throw { status: 0 };
  });
  await expect(journal.execute(operation, first)).rejects.toEqual({ status: 0 });
  const restored = new OperationJournal(storage, () => {
    throw new Error('Must reuse saved key');
  });
  const send = vi.fn(async () => 'confirmed');
  expect(await restored.execute(operation, send)).toBe('confirmed');
  expect(send).toHaveBeenCalledWith({ key, operation });
  expect(await restored.pending()).toBeNull();
});
test('a different quote or transition payload cannot replace an unresolved command', async () => {
  const { journal } = fixture();
  await expect(
    journal.execute(operation, async () => {
      throw { status: 503 };
    }),
  ).rejects.toBeDefined();
  const send = vi.fn();
  await expect(journal.execute({ ...operation, quoteId: key }, send)).rejects.toBeInstanceOf(
    PendingOperationError,
  );
  expect(send).not.toHaveBeenCalled();
});
test('disk failure stops network submission', async () => {
  const { storage } = fixture();
  storage.write = async () => {
    throw new Error('Storage unavailable');
  };
  const send = vi.fn();
  await expect(new OperationJournal(storage, () => key).execute(operation, send)).rejects.toThrow(
    'Storage unavailable',
  );
  expect(send).not.toHaveBeenCalled();
});
test('auth, throttle, network and 5xx failures retain recovery while definitive rejection clears it', async () => {
  for (const status of [0, 401, 403, 429, 500, 503, 400, 404, 409, 422]) {
    const { journal } = fixture();
    await expect(
      journal.execute(operation, async () => {
        throw { status };
      }),
    ).rejects.toEqual({ status });
    expect(Boolean(await journal.pending())).toBe(![400, 404, 409, 422].includes(status));
  }
});
test('failed cleanup after confirmation keeps the same command recoverable', async () => {
  const { storage, journal } = fixture();
  storage.clear = async () => {
    throw new Error('Disk unavailable');
  };
  await expect(journal.execute(operation, async () => 'confirmed')).rejects.toThrow();
  expect((await journal.pending())?.key).toBe(key);
});
test('corrupt stored data blocks new submissions instead of silently forgetting uncertain effects', async () => {
  const { storage, journal } = fixture();
  await storage.write('invalid');
  const send = vi.fn();
  await expect(journal.execute(operation, send)).rejects.toThrow('Stored request');
  expect(send).not.toHaveBeenCalled();
});

test('simultaneous taps on the same operation share a single network submission', async () => {
  const { journal } = fixture();
  const send = vi.fn(async () => 'confirmed');
  expect(await Promise.all([journal.execute(operation, send), journal.execute(operation, send)])).toEqual([
    'confirmed',
    'confirmed',
  ]);
  expect(send).toHaveBeenCalledTimes(1);
});
test('transition recovery retains its original expected version even after screen state advances', async () => {
  const { journal, storage } = fixture();
  const original = {
    kind: 'transition' as const,
    rideId: operation.quoteId,
    state: 'completed' as const,
    version: 4,
  };
  await expect(
    journal.execute(original, async () => {
      throw { status: 0 };
    }),
  ).rejects.toBeDefined();
  const recovered = new OperationJournal(storage, () => key);
  await expect(recovered.execute({ ...original, version: 5 }, vi.fn())).rejects.toBeInstanceOf(
    PendingOperationError,
  );
  const send = vi.fn(async () => 'confirmed');
  await recovered.execute(original, send);
  expect(send).toHaveBeenCalledWith({ operation: original, key });
});

test('an uncertain driver acceptance is recovered after restart with the original offer and key', async () => {
  const { storage, journal } = fixture();
  const acceptance = { kind: 'accept' as const, offerId: '00000000-0000-4000-8000-000000000003' };
  await expect(
    journal.execute(acceptance, async () => {
      throw { status: 0 };
    }),
  ).rejects.toEqual({ status: 0 });
  const restored = new OperationJournal(storage, () => {
    throw new Error('Must reuse original key');
  });
  const send = vi.fn(async () => ({ id: 'matched-ride' }));
  await expect(restored.execute(acceptance, send)).resolves.toEqual({ id: 'matched-ride' });
  expect(send).toHaveBeenCalledWith({ key, operation: acceptance });
  expect(await restored.pending()).toBeNull();
});
