import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PaymentLossAuthorization, PaymentLossReview } from '@rove/contracts';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from './rides';
import { command, transaction } from './transactions';
import { requireStaffPermission } from './staff-access';
import { DomainError } from './errors';
const permission = 'payments.loss.allocate';
const review = () =>
  new DomainError(
    'LOSS_REVIEW_REQUIRED',
    'Refresh verified financial records and review the allocation.',
    409,
  );
type Payment = { id: string; ride_id: string; rider_id: string; driver_id: string | null };
/** Local ledger decisions only. No provider mutation and no implicit commercial liability policy. */
export class PaymentLosses {
  constructor(
    private pool: Pool,
    private source: string,
    private now: () => Date = () => new Date(),
  ) {}
  private async payment(c: PoolClient, rideId: string): Promise<Payment> {
    const p = (
      await c.query<Payment>(
        `SELECT p.id,p.ride_id,r.rider_id,r.driver_id FROM payment_attempts p
      JOIN rides r ON r.id=p.ride_id WHERE p.ride_id=$1 AND p.source=$2 FOR UPDATE OF p,r`,
        [rideId, this.source],
      )
    ).rows[0];
    if (!p) throw new DomainError('NOT_FOUND', 'Payment not found.', 404);
    return p;
  }
  private async balances(c: PoolClient, p: Payment) {
    const rows = (
      await c.query<{ account: string; amount: string }>(
        `SELECT l.account,sum(l.amount_cents)::text AS amount
      FROM ledger_postings l JOIN ledger_journals j ON j.id=l.journal_id WHERE j.attempt_id=$1 GROUP BY l.account`,
        [p.id],
      )
    ).rows;
    const amounts = Object.fromEntries(rows.map((r) => [r.account, Number(r.amount)]));
    return {
      refund: amounts.refund_suspense ?? 0,
      dispute: amounts.dispute_suspense ?? 0,
      rider: -(amounts.rider_funds ?? 0),
      driver: -(amounts.driver_payable ?? 0),
    };
  }
  private async priorAllocations(c: PoolClient, p: Payment, kind: 'refund' | 'dispute') {
    return (
      await c.query<{ account: string; owner_id: string | null; amount: string }>(
        `SELECT l.account,l.owner_id,sum(l.amount_cents)::text AS amount
       FROM ledger_postings l JOIN ledger_journals j ON j.id=l.journal_id
       JOIN payment_loss_allocations a ON a.journal_id=j.id
       WHERE j.attempt_id=$1 AND j.kind=$2 GROUP BY l.account,l.owner_id`,
        [p.id, `${kind}_loss_allocation`],
      )
    ).rows;
  }
  private async fresh(c: PoolClient, p: Payment) {
    const row = (
      await c.query(
        `SELECT f.verified_at AS refunds,d.verified_at AS disputes FROM payment_refund_checks f
      JOIN payment_dispute_checks d ON d.attempt_id=f.attempt_id WHERE f.attempt_id=$1 FOR SHARE OF f,d`,
        [p.id],
      )
    ).rows[0];
    return (
      !!row &&
      [row.refunds, row.disputes].every(
        (at: Date | null) =>
          at && at.getTime() >= this.now().getTime() - 300000 && at.getTime() <= this.now().getTime() + 10000,
      )
    );
  }
  async status(actor: Actor, rawRideId: string) {
    const rideId = z.uuid().parse(rawRideId);
    return transaction(this.pool, async (c) => {
      await requireStaffPermission(c, actor, permission);
      const p = await this.payment(c, rideId),
        b = await this.balances(c, p);
      // A zero suspense balance alone never establishes settlement eligibility. Open disputes and
      // pending refunds still require the separate provider/settlement guards.
      const fresh = await this.fresh(c, p);
      const allocatedLosses = [];
      for (const kind of ['refund', 'dispute'] as const) {
        const prior = await this.priorAllocations(c, p, kind);
        const amount = (account: string, owner: string | null) =>
          Number(prior.find((r) => r.account === account && r.owner_id === owner)?.amount ?? 0);
        allocatedLosses.push({
          kind,
          riderFundsCents: amount('rider_funds', p.rider_id),
          driverCents: amount('driver_payable', p.driver_id),
          platformCents: amount('platform_payment_losses', null),
        });
      }
      return PaymentLossReview.parse({
        allocatedLosses,
        rideId,
        refundBalanceCents: b.refund,
        disputeBalanceCents: b.dispute,
        riderFundsCents: b.rider,
        driverPayableCents: b.driver,
        verifiedRecordsCurrent: fresh,
      });
    });
  }
  async allocate(actor: Actor, rawRideId: string, raw: unknown, key: string) {
    const rideId = z.uuid().parse(rawRideId),
      input = PaymentLossAuthorization.parse(raw);
    await transaction(this.pool, (c) => requireStaffPermission(c, actor, permission));
    return command(
      this.pool,
      actor.id,
      key,
      { action: 'payment.loss.allocate', rideId, ...input },
      async (c) => {
        await requireStaffPermission(c, actor, permission);
        const p = await this.payment(c, rideId);
        if (!(await this.fresh(c, p))) throw review();
        const b = await this.balances(c, p);
        if (b[input.kind] !== input.expectedBalanceCents) throw review();
        const parts = [
          { account: 'rider_funds', owner: p.rider_id, amount: input.riderFundsCents, available: b.rider },
          { account: 'driver_payable', owner: p.driver_id, amount: input.driverCents, available: b.driver },
          {
            account: 'platform_payment_losses',
            owner: null,
            amount: input.platformCents,
            available: Infinity,
          },
        ].filter((part) => part.amount !== 0);
        if (input.expectedBalanceCents > 0) {
          if (
            parts.some(
              (part) => part.amount > part.available || (part.account === 'driver_payable' && !part.owner),
            )
          )
            throw review();
        } else {
          // Returns restore only amounts previously charged to that same party for that loss category.
          const prior = (
            await c.query<{ account: string; owner_id: string | null; amount: string }>(
              `SELECT l.account,l.owner_id,sum(l.amount_cents)::text AS amount
          FROM ledger_postings l JOIN ledger_journals j ON j.id=l.journal_id JOIN payment_loss_allocations a ON a.journal_id=j.id
          WHERE j.attempt_id=$1 AND j.kind=$2 GROUP BY l.account,l.owner_id`,
              [p.id, `${input.kind}_loss_allocation`],
            )
          ).rows;
          if (
            parts.some(
              (part) =>
                -part.amount >
                Number(
                  prior.find((r) => r.account === part.account && r.owner_id === part.owner)?.amount ?? 0,
                ),
            )
          )
            throw review();
        }
        const id = randomUUID(),
          journalId = randomUUID();
        const postings = [
          ...parts.map((part) => ({ account: part.account, owner: part.owner, amount: part.amount })),
          { account: `${input.kind}_suspense`, owner: null, amount: -input.expectedBalanceCents },
        ];
        const fingerprint = createHash('sha256')
          .update(JSON.stringify({ rideId, input, postings }))
          .digest('hex');
        await c.query(
          `INSERT INTO ledger_journals(id,key,fingerprint,attempt_id,ride_id,kind) VALUES($1,$2,$3,$4,$5,$6)`,
          [journalId, `loss-allocation:${id}`, fingerprint, p.id, rideId, `${input.kind}_loss_allocation`],
        );
        for (const entry of postings)
          await c.query(
            `INSERT INTO ledger_postings(journal_id,account,owner_id,amount_cents) VALUES($1,$2,$3,$4)`,
            [journalId, entry.account, entry.owner, entry.amount],
          );
        await c.query(
          `INSERT INTO payment_loss_allocations(id,journal_id,authorized_by,policy_reference) VALUES($1,$2,$3,$4)`,
          [id, journalId, actor.id, input.policyReference],
        );
        await c.query(
          `INSERT INTO audit(actor_id,action,aggregate_id,metadata) VALUES($1,'staff.payment_loss_allocated',$2,$3)`,
          [actor.id, id, JSON.stringify({ rideId, ...input, journalId })],
        );
        return { id, journalId };
      },
    );
  }
}
