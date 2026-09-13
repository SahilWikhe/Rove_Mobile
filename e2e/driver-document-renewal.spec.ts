import { expect, test } from './fixtures';

test('driver sees reviewed credential renewal warning and opens renewal guidance', async ({ page }) => {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await page.route('**/v1/drivers/me/documents', (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            kind: 'driver_license',
            state: 'quarantined',
            verification: 'awaiting_review',
            createdAt: '2026-09-01T00:00:00Z',
            expiresAt: '2026-09-01T00:15:00Z',
            review: { status: 'approved', reason: null, reviewedAt: '2026-09-01T00:00:00Z', expiresAt },
          },
        ],
      },
    }),
  );
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Open your account', exact: true }).click();
  const documents = page.getByRole('button', { name: 'Documents & credentials', exact: true });
  await expect(documents.getByText('1 expiring soon', { exact: true })).toBeVisible();
  await documents.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/rove-driver-renewal-account.png' });
  await documents.click();
  await expect(page.getByText(/Expiring soon · .*Upload a renewed copy before it expires/)).toBeVisible();
  await page.screenshot({ path: '/tmp/rove-driver-renewal-guidance.png' });
});
