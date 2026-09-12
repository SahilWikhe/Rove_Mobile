# Captured funds and earnings subledger

Reviewed against the September 12, 2026 source baseline. Verification counts and screenshots below record feature checkpoints, not a fresh full-suite or production acceptance run. See [current status](18-implementation-status.md) for deployment and remaining release work.

## Implemented accounting records

Migration `0010_funny_wallow.sql` introduces append-only journals and postings. This operational subledger currently uses integer USD cents only. Positive postings are debits; negative postings are credits. Provider authorization holds do not create captured-money entries.

A verified successful capture debits `stripe_clearing` and credits the rider's `rider_funds` liability. This records funds captured by the processor, not cash already deposited into Rove's bank account. A full capture for a completed ride with an assigned driver and valid quoted earnings then debits that rider liability and credits `driver_payable` and the remaining gross `platform_revenue` allocation. Zero-value postings are omitted.

Partial captures, unexpected ride states, missing driver assignment or earnings exceeding captured funds remain unallocated and require review. No driver payout or net-profit claim follows from a ledger posting. The commercial fare/earnings policy, merchant/Connect model and fee/tax treatment still require final approval. Stripe processing fees, refunds, disputes, bank settlements and payouts require additional journals and are not covered by these capture/allocation records.

## Database guarantees

Each journal has a unique attempt/operation key and a fingerprint of its ride and postings. Concurrent retries serialize on that key; identical retries reuse the journal, while conflicting amounts or allocations require review. A capture is a final provider result, not an incremental hold estimate. An inconsistent later capture amount does not silently overwrite the first posting; resolution needs an explicit correction/reconciliation workflow.

Deferred PostgreSQL constraint triggers require at least two postings and a zero sum at transaction commit. This also rejects a journal header with no postings, including through direct SQL. Row triggers reject updates/deletes to journals and postings. New postings must be inserted in the same database transaction as their journal, preventing a later caller from extending a committed journal even with an additional balanced pair. The migration contains these custom trigger definitions in addition to the generated Drizzle schema.

These guarantees protect normal DML. Production database roles must separately deny application access to `TRUNCATE`, schema modification and trigger disablement. A database owner can bypass database-level protections; runtime-role provisioning remains part of deployment hardening. Disposable tests intentionally use `TRUNCATE ... CASCADE` for fixture cleanup.

## Ride settlement integration

Payment reconciliation writes captured-money and eligible earnings postings in the same transaction as the attempt revision, ride payment state, audit and outbox events. A ledger error rolls back all local changes. The provider may already have captured funds; the worker then retries retrieval and the same durable local operation rather than creating another charge.

The ledger records actual received funds even for a partial capture requiring review. Duplicate successful reconciliations do not duplicate revenue or driver payables. A driver payable represents an allocated obligation, not a completed transfer to the driver's bank.

## Verification and next steps

Six database-backed ledger tests cover concurrent duplicate settlement, account totals, partial capture, conflicting replay, empty/unbalanced direct-SQL journals, committed-record immutability, attempts to append later lines, transaction rollback and invalid earnings. A reconciliation test injects a ledger-write failure, confirms payment state/revision roll back, and verifies a later retry records the capture. All data and provider responses are synthetic.

Remaining: owner-scoped receipts and earnings APIs/UI, refund/dispute/fee/payout journal operations, correction and review tools, provider balance reconciliation, final accounting/business-policy review, restricted runtime database role and production/sandbox acceptance. Existing fixture payment states are not evidence of ledger-backed settlement; real-provider runtime composition still needs verification.
