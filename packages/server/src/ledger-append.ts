import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
export interface LedgerPosting {
  account: string;
  ownerId: string | null;
  amountCents: number;
}
/** Caller owns authorization, idempotency checks and transaction; database constraints enforce balance. */
export async function appendLedgerJournal(
  client: PoolClient,
  journal: { id?: string; key: string; fingerprint: string; attemptId: string; rideId: string; kind: string },
  postings: LedgerPosting[],
): Promise<string> {
  const id = journal.id ?? randomUUID();
  await client.query(
    'INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind) VALUES($1,$2,$3,$4,$5,$6)',
    [id, journal.key, journal.fingerprint, journal.attemptId, journal.rideId, journal.kind],
  );
  for (const posting of postings)
    await client.query(
      'INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents) VALUES($1,$2,$3,$4)',
      [id, posting.account, posting.ownerId, posting.amountCents],
    );
  return id;
}
