import { expect, test } from './fixtures';
import { randomUUID } from 'node:crypto';
for (const width of [320, 390])
  test(`driver net earnings and signed adjustment activity at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const rideId = randomUUID();
    const money = (amount: number) => ({ amount, currency: 'USD' });
    let legacy = false;
    await page.route('**/v1/drivers/me/earnings?**', async (route) => {
      expect(new URL(route.request().url()).searchParams.get('details')).toBe('adjustments');
      await route.fulfill({
        json: {
          recordedTotal: money(790),
          periodTotal: money(790),
          ...(!legacy
            ? {
                netTotal: money(540),
                periodNetTotal: money(540),
                adjustmentTotal: money(-250),
                periodAdjustmentTotal: money(-250),
              }
            : {}),
          entries: (!legacy
            ? [
                ['refund_loss_allocation', -200],
                ['dispute_loss_allocation', -100],
                ['refund_loss_allocation', 50],
                ['allocation', 790],
              ]
            : [['allocation', 790]]
          ).map(([kind, amount]) => ({
            id: randomUUID(),
            rideId,
            recordedAt: '2026-09-12T12:00:00.000Z',
            amount: money(amount as number),
            ...(!legacy ? { kind } : {}),
          })),
          hasMore: false,
          nextCursor: null,
          payoutStatus: 'not_configured',
        },
      });
    });
    await page.goto('http://localhost:8092');
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'Earnings', exact: true }).click();
    await expect(page.getByText('NET EARNINGS', { exact: true })).toBeVisible();
    await expect(page.getByText('$5.40', { exact: true })).toBeVisible();
    await expect(page.getByText('Gross trip earnings', { exact: true })).toBeVisible();
    await expect(page.getByText('-$2.50', { exact: true })).toBeVisible();
    await page.screenshot({ path: `reports/driver-adjustments-${width}.png`, fullPage: true });
    for (const label of ['REFUND ADJUSTMENT', 'DISPUTE ADJUSTMENT', 'REFUND REVERSAL', 'TRIP EARNINGS']) {
      await page.getByText(label, { exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(
      page.getByText('Recorded earnings are not an available withdrawal balance.', { exact: true }),
    ).toBeAttached();
    legacy = true;
    await page.getByRole('button', { name: 'Drive', exact: true }).click();
    await page.getByRole('button', { name: 'Earnings', exact: true }).click();
    await expect(page.getByText('GROSS TRIP EARNINGS', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Gross trip earnings. Adjustment details are not available from this server.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText('NET EARNINGS', { exact: true })).toHaveCount(0);
  });
