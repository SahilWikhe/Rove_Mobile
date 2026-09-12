# Refund tracking and recovery

## Scope

Refund tracking is implemented locally behind `PAYMENT_REFUNDS_ENABLED=true`. It reads provider facts; it does not authorize or create refunds, alter capture journals, reverse driver earnings, resolve disputes or perform transfers. Those financial operations and business policies remain separate launch work.

## Durable flow

Authenticated Stripe `refund.created`, `refund.updated` and `refund.failed` events are reconciliation hints. The inbox deduplicates them and atomically queues `refund.reconcile` for the linked PaymentIntent. Legacy refunds without a PaymentIntent are ignored. Raw event amounts and status never become receipt truth.

The worker verifies the persisted account/mode, customer, rider, ride, payment attempt and amount against Stripe before reading complete bounded refund history. Missing pages, contradictory references and excessive amounts preserve the last verified observation. Provider calls occur outside the database transaction; revision fencing prevents overlapping older responses overwriting a newer result. The current check and immutable changed-fact history commit together. Failure rolls back both and retries through the outbox.

Recovery scans paid/review-required rides for checks older than one hour or never verified, at most 100 candidates per sweep. Requested timestamps prioritize untouched candidates, prevent a failed first page starving later payments, and defer reselection for ten minutes. Hour-bucket deduplication bounds repeated wakeups; this is not an exact delivery SLA. Signed events can trigger earlier reconciliation. Provider failures remain visible to worker retry/dead-letter operations.

## Rider behavior

The owned receipt optionally includes a verification timestamp and refund facts. Unchecked history is explicitly unknown. Checked empty history means no refunds recorded at that check. Pending, requires-action, succeeded, failed and canceled states remain distinct. Original captured funds stay visible separately; a refund is not silently deducted from a historical capture or claimed settled from a creation response. Provider intent/customer identifiers are excluded. Support remains available from the receipt.

## Rollout order

1. Deploy compatible rider clients accepting the optional refund receipt field; older strict clients may reject it.
2. Apply versioned migration `0031_refund_observations` through the environment's explicit migration procedure. Never migrate during startup/build.
3. Deploy API and worker code with the flag off, preserving existing receipt behavior and avoiding new-table queries in the disabled path.
4. Include the three refund event types on the environment's existing signed Stripe webhook endpoint. Retain the existing payment event subscriptions.
5. Set `PAYMENT_REFUNDS_ENABLED=true` for both API and worker using the matching account/mode configuration. Exercise sandbox pending/success/failure and missed-event recovery before production approval.

Rollback disables the flag on API and worker. Preserve observation tables and history. Drain or retain existing refund jobs deliberately; a disabled worker no longer registers their handler. Do not delete financial history to roll back application code.

## Verification and remaining work

Disposable PostgreSQL tests cover atomicity, immutable history, conflicting reads, references, contradictory results and bounded fair recovery. Signed SDK webhook/API tests verify deduplication, runtime gating and owned receipt serialization through the outbox worker. Browser tests exercise all refund statuses and support navigation at 320 and 390 pixels. Stripe transport is mocked; these are local tests, not hosted sandbox or physical-device acceptance.

The next checkpoint adds [staff-authorized refund operations](67-refund-operations.md) with cumulative limits and bounded retry recovery. Remaining work includes controlled ambiguous-outcome resolution, commercial loss allocation, dispute handling, and approved driver transfer/settlement workflows. Metadata correlation recovery and processor balance journals are documented in [refund accounting](68-refund-accounting.md). See [current status](18-implementation-status.md).
