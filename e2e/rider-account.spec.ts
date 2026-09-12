import { expect, test } from './fixtures';

test('Rider Account exposes working profile editing and selected navigation', async ({ page }) => {
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Account', exact: true }).getByText('Account', { exact: true }),
  ).toHaveCSS('color', 'rgb(207, 185, 125)');
  await expect(page.getByText('Alex Rider', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/rove-account-figma-web.png', fullPage: true });
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
  await expect(page.getByText('Your journeys.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'My rides', exact: true }).getByText('My rides', { exact: true }),
  ).toHaveCSS('color', 'rgb(207, 185, 125)');
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Where are you going?', exact: true })).toBeVisible();
});
