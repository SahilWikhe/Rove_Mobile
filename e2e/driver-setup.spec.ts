import { test, expect } from './fixtures';
test('driver setup shows authoritative statuses and leads to vehicle and payout actions', async ({
  page,
}) => {
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Driver setup', exact: true }).click();
  await expect(page.getByText('Your road to ready.', { exact: true })).toBeVisible();
  await expect(page.getByText('Payout setup is not available yet.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh setup status', exact: true }).click();
  await expect(page.getByText('Payout setup is not available yet.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View payout setup', exact: true }).click();
  await expect(page.getByText('Your payout details.', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Your road to ready.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^(Add your vehicle|Review vehicle details)$/ }).click();
  await expect(page.getByText('Your vehicle.', { exact: true })).toBeVisible();
});

test('setup clears previous eligibility while a refresh fails and recovers on retry', async ({
  page,
}, testInfo) => {
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Driver setup', exact: true }).click();
  await expect(page.getByText('Driving eligibility', { exact: true })).toBeVisible();
  const endpoint = '**/v1/drivers/me/vehicle-submission';
  await page.route(endpoint, (route) => route.abort());
  await page.getByRole('button', { name: 'Refresh setup status', exact: true }).click();
  await expect(
    page.getByText('Unable to check your setup. Retry to see the latest status.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Driving eligibility', { exact: true })).toHaveCount(0);
  await page.unroute(endpoint);
  await page.getByRole('button', { name: 'Refresh setup status', exact: true }).click();
  await expect(page.getByText('Driving eligibility', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('driver-setup.png'), fullPage: true });
});

test('setup distinguishes expired approval from payout requirements and offers the right action', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let eligibilityStatus = 'payout_required';
  await page.route('**/v1/drivers/me', async (route) => {
    const response = await route.fetch();
    const profile = await response.json();
    await route.fulfill({
      json: { ...profile, approved: true, eligible: false, payoutReady: false, eligibilityStatus },
    });
  });
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Driver setup', exact: true }).click();
  await expect(
    page.getByText('Your driving review is complete. Finish or refresh your payout setup to go online.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue payout setup', exact: true }).click();
  await expect(page.getByText('Your payout details.', { exact: true })).toBeVisible();
  eligibilityStatus = 'expired';
  await page.goBack();
  await expect(
    page.getByText('Your driving approval has expired. Contact Rove for a new review.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue payout setup', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('expired-eligibility.png'), fullPage: true });
  await page.getByRole('button', { name: 'Get help with eligibility', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Help & support', exact: true })).toBeVisible();
});
