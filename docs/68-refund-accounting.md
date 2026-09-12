# Refund balance accounting and correlation recovery

## Verified financial facts

The Stripe refund reader expands both `balance_transaction` and `failure_balance_transaction`. It validates USD currency, refund source, transaction type, amount direction and exact `net = amount - fee` arithmetic. Unexpanded identifiers, duplicate financial references and contradictory records fail verification. A normalized transaction cannot disappear or change after being recorded in refund observation history.

Refund status and processor balance movement are different facts. A pending refund can already reduce the processor balance. A failed refund does not prove money was restored: the reader must find the failure balance transaction. Processor pending/available balance is not proof of a bank deposit or customer receipt.

## Operational subledger

With migration 0033 and `PAYMENT_REFUND_ACCOUNTING_ENABLED=true`, verified processor movements create immutable balanced journals in the same transaction as the refund observation update. The flag requires refund tracking and defaults off. It is independent of refund creation, so authorized external/dashboard refunds can also be accounted for.

Each movement has a source-account/mode and provider-transaction key. Concurrent identical retries reuse the journal. A different attempt, amount, fee, refund or posting set under that key requires review. PostgreSQL still enforces balanced postings and rejects changes to committed journals.

Postings use integer USD cents, with debits positive and credits negative:

| Account | Posting |
| --- | --- |
| `stripe_clearing` | Verified net processor balance impact |
| `refund_suspense` | Opposite of the verified gross refund movement |
| `processor_fees` | Verified fee or fee credit |

Zero postings are omitted. A failure balance transaction creates a separate compensating journal; it never edits the original. A capture journal matching the verified received amount must exist before refund movements are posted. Missing capture/financial evidence or a failed ledger insert rolls back the current observation as well and permits recovery.

`refund_suspense` deliberately leaves commercial loss allocation unresolved. Original rider capture, driver payable and gross revenue records remain unchanged. An approved accounting policy and staff adjustment workflow must resolve suspense before affected driver settlements are authorized. This is an operational subledger component, not a complete general ledger, tax calculation or bank reconciliation.

## Lost response recovery

New refund mutations include the immutable Rove operation UUID in Stripe metadata. Only this validated correlation field is retained; arbitrary provider metadata does not enter receipts or operation responses.

Before retrying an uncertain mutation, the worker refreshes complete provider history. One matching operation UUID, amount and plausible creation time can bind the existing refund without another mutation, including after the 23-hour retry cutoff. Duplicate correlation matches, contradictory amounts, missing metadata or unrelated same-amount refunds cannot authorize binding.

`POST /v1/staff/rides/:id/refunds/:operationId/recover` provides the same read-only-provider recovery with staff MFA and `payments.refund` permission. Repeated calls do not issue refunds or duplicate audit bindings. A missing match stays queued/review-required; absence from a list never authorizes blind reissue. Legacy uncorrelated outcomes or contradictory records still require controlled provider-support review. No route marks an unproven refund absent or frees its reservation.

## Rollout and acceptance

1. Apply migrations 0031–0033 through the explicit environment migration procedure; never through startup/build.
2. Ensure the restricted Stripe credential can read refunds and their expanded balance transactions. Keep account/mode and signing secrets separated by environment.
3. Deploy compatible API/worker and receipt clients. Set `PAYMENT_REFUNDS_ENABLED=true`, then enable refund accounting only after provider and ledger acceptance.
4. Verify pending, succeeded, failed and failure-reversal cases on dedicated sandbox payments, plus a lost-response correlation recovery. Retain and monitor dead letters, suspense and unbound authorizations.
5. Keep `PAYMENT_REFUND_OPERATIONS_ENABLED=false` until commercial policy, financial review and settlement safeguards are accepted separately.

No cloud migration, provider call or monetary transaction was performed by the local test run. No hosted rollout flags were changed. Physical/native payment acceptance, broader provider balance reconciliation, dispute workflows and driver settlement remain release work.

## Verification

Provider adapter tests cover correlation redaction, metadata validation, expanded transaction references, currency, signs and arithmetic. PostgreSQL tests cover concurrent deduplication, balanced fee/suspense entries, verified failure reversals, unchanged driver payable, missing/changed evidence and ledger/observation rollback. Operation tests cover aged lost responses, metadata recovery and denial of amount-only guesses. API tests verify recovery permission boundaries and explicitly enabled runtime composition.

## Provider references

- [Refund financial references and failure adjustments](https://docs.stripe.com/api/refunds/object)
- [Balance transaction amount, fee and net fields](https://docs.stripe.com/api/balance_transactions/object)
