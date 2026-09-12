import { expect, test } from './fixtures';

test('compact route panel supports destination-first entry and editing without losing the other endpoint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Where are you going?', exact: true }).click();
  await page.getByRole('button', { name: 'Enter destination address', exact: true }).click();
  await page.getByRole('textbox', { name: 'Destination address', exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Search places', exact: true }).click();
  await page.getByRole('button', { name: 'Work · synthetic destination', exact: true }).click();
  await page.getByRole('textbox', { name: 'Pickup address', exact: true }).fill('Home');
  await page.getByRole('button', { name: 'Search places', exact: true }).click();
  await page.getByRole('button', { name: 'Home · synthetic pickup', exact: true }).click();
  await page.getByRole('button', { name: 'Change pickup', exact: true }).click();
  await expect(page.getByText('Work · synthetic destination', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Pickup address', exact: true }).fill('Home');
  // The native keyboard Search action follows the same explicit search path.
  await page.getByRole('textbox', { name: 'Pickup address', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Home · synthetic pickup', exact: true }).click();
  let requests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/v1/ride-requests')) requests++;
  });
  await page.clock.install();
  await page.route('**/v1/quotes', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
  });
  await page.getByRole('button', { name: 'See your fare', exact: true }).click();
  await expect(page.getByText('Pickup: Home · synthetic pickup', { exact: true })).toBeVisible();
  await expect(page.getByText('Destination: Work · synthetic destination', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/rider-quote-current.png', fullPage: true });
  await page.clock.fastForward(61_000);
  await expect(
    page.getByText('This fare has expired. Review an updated fare before requesting your ride.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/rider-quote-expired.png', fullPage: true });
  await page.getByRole('button', { name: 'Review updated fare', exact: true }).click();
  expect(requests).toBe(0);
  await expect(page.getByRole('button', { name: 'Change pickup', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change destination', exact: true })).toBeVisible();
  await page.unroute('**/v1/quotes');
  await page.clock.resume();
  await page.getByRole('button', { name: 'See your fare', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Edit route or service', exact: true }).click();
  await page.getByRole('button', { name: 'Close booking', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Where are you going?', exact: true })).toBeVisible();
});
