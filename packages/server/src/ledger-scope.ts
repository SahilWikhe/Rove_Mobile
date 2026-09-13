import type { PoolClient } from 'pg';
import { z } from 'zod';
/** Backend-only scopes; financial services authorize and lock the payment before binding. */
export async function bindLedgerAttempt(c: PoolClient, attemptId: string) {
  z.uuid().parse(attemptId);
  await c.query("SELECT set_config('rove.ledger_attempt',$1,true),set_config('rove.ledger_owner','',true)", [
    attemptId,
  ]);
}
export async function bindLedgerOwner(c: PoolClient, ownerId: string) {
  z.uuid().parse(ownerId);
  await c.query("SELECT set_config('rove.ledger_attempt','',true),set_config('rove.ledger_owner',$1,true)", [
    ownerId,
  ]);
}
