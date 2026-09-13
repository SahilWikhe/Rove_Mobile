import { expect, test } from './fixtures';

test('booking shows suggestions before typing and searches automatically', async ({ page }) => {
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a destination', exact: true }).click();
  await expect(page.getByText('Suggested places', { exact: true })).toBeVisible();
  const home = page.getByRole('button', { name: 'Home · synthetic pickup', exact: true });
  await expect(home).toBeVisible();
  await page.screenshot({ path: '/tmp/rove-booking-nearby.png' });
  await home.click();
  await page.getByRole('textbox', { name: 'Destination address', exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Work · synthetic destination', exact: true }).click();
  await expect(page.getByRole('button', { name: 'See your fare', exact: true })).toBeVisible();
});

test('nearby failure preserves manual address search', async ({ page }) => {
  await page.route('**/v1/places/nearby', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'MAPS_UNAVAILABLE', message: 'Nearby places are unavailable.' } },
    }),
  );
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a destination', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Suggest places around me', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Pickup address', exact: true }).fill('Home');
  await expect(page.getByRole('button', { name: 'Home · synthetic pickup', exact: true })).toBeVisible();
});
