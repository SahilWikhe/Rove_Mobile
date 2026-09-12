import { expect, test } from './fixtures';

test('Rider Account exposes working profile editing and selected navigation', async ({ page, request }) => {
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Account', exact: true }).getByText('Account', { exact: true }),
  ).toHaveCSS('color', 'rgb(207, 185, 125)');
  await expect(page.getByText('Alex Rider', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/rove-account-figma-web.png', fullPage: true });
  const placesResponse = await request.get('http://localhost:4085/v1/saved-places', {
    headers: { Authorization: 'Bearer synthetic-rider' },
  });
  expect(placesResponse.ok()).toBe(true);
  const count = String((await placesResponse.json()).places.length);
  const saved = page.getByRole('button', { name: 'Saved places', exact: true });
  await expect(saved.getByText(count, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'About Rove', exact: true }).click();
  await expect(page.getByText('Rove Rider', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Version /)).toBeVisible();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await page.route('**/v1/saved-places', (route) => route.abort());
  await page.getByRole('button', { name: 'About Rove', exact: true }).click();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await expect(saved.getByText(count, { exact: true })).toHaveCount(0);
  await page.unroute('**/v1/saved-places');
  await page.getByRole('button', { name: 'About Rove', exact: true }).click();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await expect(saved.getByText(count, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Your name', exact: true });
  await name.fill('Alex Test Rider');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByText('Your name is saved.', { exact: true })).toBeVisible();
  await name.fill('Alex Rider');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByText('Your name is saved.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await page.getByRole('button', { name: 'My rides', exact: true }).click();
  await expect(page.getByText('Your rides and their latest status', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'My rides', exact: true }).getByText('My rides', { exact: true }),
  ).toHaveCSS('color', 'rgb(207, 185, 125)');
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Where are you going?', exact: true })).toBeVisible();
});
