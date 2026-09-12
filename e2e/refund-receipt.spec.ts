import { expect, test } from './fixtures';
import { randomUUID } from 'node:crypto';
for (const width of [320, 390]) {
  test(`rider refund receipt distinguishes all provider statuses at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const rideId = randomUUID();
    let checked = false;
    const trip = {
      id: rideId,
      state: 'completed',
      version: 1,
      fare: { amount: 1050, currency: 'USD' },
      paymentState: 'paid',
      pickupArea: 'Home',
      destinationArea: 'Work',
      createdAt: '2026-09-12T12:00:00.000Z',
    };
    await page.route('**/v1/rides', (route) => route.fulfill({ json: { rides: [trip], nextCursor: null } }));
    await page.route(`**/v1/rides/${rideId}`, (route) => route.fulfill({ json: trip }));
    await page.route(`**/v1/rides/${rideId}/receipt`, async (route) => {
      await route.fulfill({
        json: {
          id: randomUUID(),
          rideId,
          recordedAt: '2026-09-12T12:00:00.000Z',
          quotedFare: { amount: 1050, currency: 'USD' },
          capturedAmount: { amount: 1050, currency: 'USD' },
          rideState: 'completed',
          paymentState: 'paid',
          refunds: {
            verifiedAt: checked ? '2026-09-12T12:01:00.000Z' : null,
            items: checked
              ? (['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const).map(
                  (status, index) => ({
                    id: `re_fixture${index}`,
                    amount: { amount: 100, currency: 'USD' },
                    status,
                    createdAt: '2026-09-12T12:00:00.000Z',
                  }),
                )
              : [],
          },
        },
      });
    });
    await page.goto('http://localhost:8091');
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'My rides', exact: true }).click();
    await page.getByRole('button', { name: /Home to Work, completed/ }).click();
    await page.getByRole('button', { name: 'View receipt', exact: true }).click();
    await expect(
      page.getByText(
        'Refund updates have not been checked yet. This does not confirm whether a refund exists.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText('No refunds recorded at the last check.', { exact: true })).toHaveCount(0);
    checked = true;
    await page.getByRole('button', { name: 'Back to ride', exact: true }).click();
    await page.getByRole('button', { name: 'View receipt', exact: true }).click();
    for (const label of [
      'REFUND PENDING',
      'REFUND NEEDS ACTION',
      'REFUND COMPLETED',
      'REFUND FAILED',
      'REFUND CANCELED',
    ])
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText('$10.50', { exact: true }).filter({ visible: true })).toHaveCount(2);
    await page.getByText('REFUND COMPLETED', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `reports/refund-receipt-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Get help with this payment', exact: true }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === '/support' && url.searchParams.get('rideId') === rideId,
    );
  });
}
