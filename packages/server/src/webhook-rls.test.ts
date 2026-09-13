import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { testDatabase } from '@rove/database/testing';
import { PaymentWebhookInbox } from './payment-webhooks';
import { PayoutWebhookInbox } from './payout-webhooks';
import { bindWebhookScope } from './webhook-scope';
import { transaction } from './transactions';
let db: Awaited<ReturnType<typeof testDatabase>>, runtime: Pool;
const source = 'acct_fixture:test';
beforeAll(async () => {
  db = await testDatabase();
  await db.pool.query(
    "CREATE ROLE rls_webhook LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-local-only'",
  );
  await db.pool.query('GRANT USAGE ON SCHEMA public TO rls_webhook');
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_webhook');
  await db.pool.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO rls_webhook');
  runtime = new Pool({
    host: '127.0.0.1',
    port: (await db.pool.query('SELECT inet_server_port() AS port')).rows[0].port,
    database: 'postgres',
    user: 'rls_webhook',
    password: 'synthetic-local-only',
    max: 1,
  });
}, 60000);
afterAll(async () => {
  await runtime?.end();
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE payment_webhook_events,payout_webhook_events,outbox CASCADE');
});
for (const kind of ['payment', 'payout'] as const) {
  const table = `${kind}_webhook_events`;
  function fixture() {
    const hint = {
      id: 'evt_fixture',
      type: 'payment_intent.succeeded',
      created: 1700000000,
      resourceId: 'pi_fixture',
    };
    const payout = {
      id: 'evt_fixture',
      type: 'v2.core.account.updated',
      created: '2026-09-13T00:00:00Z',
      accountId: 'acct_driver',
    };
    const verify = vi.fn(() => (kind === 'payment' ? hint : payout));
    const inbox =
      kind === 'payment'
        ? new PaymentWebhookInbox(runtime, { verifyWebhook: () => verify() as typeof hint }, source)
        : new PayoutWebhookInbox(runtime, { verify: () => verify() as typeof payout }, source);
    return {
      inbox,
      verify,
      change: () => {
        hint.resourceId = 'pi_changed';
        payout.accountId = 'acct_changed';
      },
    };
  }
  test(`${kind} restricted inbox retries atomically and detects conflicting receipts`, async () => {
    const { inbox, verify, change } = fixture();
    await inbox.receive(Buffer.from('synthetic'), 'synthetic');
    await inbox.receive(Buffer.from('synthetic'), 'synthetic');
    expect(verify).toHaveBeenCalledTimes(2);
    expect((await db.pool.query(`SELECT * FROM ${table}`)).rowCount).toBe(1);
    expect((await db.pool.query('SELECT * FROM outbox')).rowCount).toBe(1);
    change();
    await expect(inbox.receive(Buffer.from('synthetic'), 'synthetic')).rejects.toMatchObject({
      code: kind === 'payment' ? 'PAYMENT_EVENT_CONFLICT' : 'PAYOUT_EVENT_CONFLICT',
    });
    expect((await runtime.query(`SELECT * FROM ${table}`)).rowCount).toBe(0);
  });
  test(`${kind} inbox scope cannot read other events or sources, mutate receipts or insert foreign events`, async () => {
    await fixture().inbox.receive(Buffer.from('synthetic'), 'synthetic');
    await transaction(runtime, async (c) => {
      await bindWebhookScope(c, kind, source, 'evt_fixture');
      expect((await c.query(`SELECT * FROM ${table}`)).rowCount).toBe(1);
      expect((await c.query(`UPDATE ${table} SET event_type='forged'`)).rowCount).toBe(0);
      expect((await c.query(`DELETE FROM ${table}`)).rowCount).toBe(0);
      await bindWebhookScope(c, kind, source, 'evt_other');
      expect((await c.query(`SELECT * FROM ${table}`)).rowCount).toBe(0);
      await bindWebhookScope(c, kind, 'acct_other:test', 'evt_fixture');
      expect((await c.query(`SELECT * FROM ${table}`)).rowCount).toBe(0);
    });
    await expect(
      transaction(runtime, async (c) => {
        await bindWebhookScope(c, kind, source, 'evt_fixture');
        const resource = kind === 'payment' ? 'resource_id' : 'account_id';
        const created = kind === 'payment' ? 1700000000 : '2026-09-13T00:00:00Z';
        await c.query(
          `INSERT INTO ${table}(source,event_id,event_type,${resource},provider_created) VALUES($1,'evt_foreign','synthetic',$2,$3)`,
          [source, kind === 'payment' ? 'pi_fixture' : 'acct_driver', created],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await runtime.query(`SELECT * FROM ${table}`)).rowCount).toBe(0);
  });
  test(`${kind} inbox rolls back its receipt when enqueue fails and can retry`, async () => {
    const { inbox } = fixture();
    await db.pool.query('ALTER TABLE outbox ADD CONSTRAINT synthetic_reject_enqueue CHECK(false) NOT VALID');
    try {
      await expect(inbox.receive(Buffer.from('synthetic'), 'synthetic')).rejects.toThrow();
    } finally {
      await db.pool.query('ALTER TABLE outbox DROP CONSTRAINT synthetic_reject_enqueue');
    }
    expect((await db.pool.query(`SELECT * FROM ${table}`)).rowCount).toBe(0);
    await inbox.receive(Buffer.from('synthetic'), 'synthetic');
    expect((await db.pool.query(`SELECT * FROM ${table}`)).rowCount).toBe(1);
    expect((await db.pool.query('SELECT * FROM outbox')).rowCount).toBe(1);
  });
}
