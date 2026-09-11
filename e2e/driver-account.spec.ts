import { expect, test } from './fixtures';

test('Driver Account navigation opens trips and earnings with a route back', async ({ page }) => {
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open your account', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Drive', exact: true }).getByText('Drive', { exact: true }),
  ).toHaveCSS('color', 'rgb(214, 178, 109)');
  await expect(page.getByRole('button', { name: 'Go online', exact: true })).toBeEnabled();
  await page.screenshot({ path: '/tmp/rove-driver-drive-figma-web.png', fullPage: true });
  await page.getByRole('button', { name: 'Open your account', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Account', exact: true }).getByText('Account', { exact: true }),
  ).toHaveCSS('color', 'rgb(214, 178, 109)');
  await page.screenshot({ path: '/tmp/rove-driver-account-figma-web.png', fullPage: true });
  await page.getByRole('button', { name: 'Trips', exact: true }).click();
  await expect(page.getByText('Your rides and their latest status', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Earnings', exact: true }).click();
  await expect(page).toHaveURL(/\/earnings$/);
  await page.getByRole('tab', { name: 'Last 7 days', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Last 7 days', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Review payout setup', exact: true })).toBeVisible();
  await expect(page.getByTestId('daily-earnings').getByRole('img')).toHaveCount(7);
  await page.screenshot({ path: '/tmp/rove-driver-earnings-figma-web.png', fullPage: true });
  await page.getByRole('button', { name: 'Filter recorded dates', exact: true }).click();
  await page.getByRole('textbox', { name: 'From date (UTC)', exact: true }).fill('2026-02-30');
  await page.getByRole('textbox', { name: 'Through date (UTC)', exact: true }).fill('2026-03-01');
  await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(
    page.getByText('Enter valid dates with the start on or before the end.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'From date (UTC)', exact: true }).fill('2000-01-01');
  await page.getByRole('textbox', { name: 'Through date (UTC)', exact: true }).fill('2000-01-31');
  await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(page.getByText('2000-01-01 – 2000-01-31 · UTC', { exact: true })).toBeVisible();
  await expect(page.getByTestId('daily-earnings').getByRole('img')).toHaveCount(31);
  await expect(page.getByText('No recorded earnings in this date range.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filter recorded dates', exact: true }).click();
  await page.getByRole('button', { name: 'All recorded dates', exact: true }).click();
  await page.getByRole('button', { name: 'Filter recorded dates', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'From date (UTC)', exact: true })).toHaveValue('');
  await expect(page.getByText('2000-01-01 – 2000-01-31 · UTC', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('daily-earnings')).toHaveCount(0);
  await page.getByRole('button', { name: 'Drive', exact: true }).click();
  await expect(page).toHaveURL(/\/drive$/);
});

test('Driver online map layout keeps offline control reachable', async ({ page }) => {
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Go online', exact: true }).click();
  await expect(page.getByText('Waiting for a request…', { exact: true })).toBeVisible();
  await expect(page.getByText('You’re online · looking for rides', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go offline', exact: true })).toBeEnabled();
  await page.screenshot({ path: '/tmp/rove-driver-waiting-web.png', fullPage: true });
  await page.getByRole('button', { name: 'Go offline', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open your account', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go online', exact: true })).toBeEnabled();
});
