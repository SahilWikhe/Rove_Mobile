import { expect, test } from './fixtures';

test('Account saved places supports save, stale-write recovery and removal without booking', async ({
  page,
  request,
}) => {
  const headers = { Authorization: 'Bearer synthetic-rider' };
  const endpoint = 'http://localhost:4085/v1/saved-places/home';
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Saved places', exact: true }).click();
  await expect(page.getByText('No place saved yet.', { exact: true })).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Saved place address', exact: true }).fill('Home');
  await page.getByRole('button', { name: 'Search places', exact: true }).click();
  await page.getByRole('button', { name: 'Home · synthetic pickup', exact: true }).click();
  await page.getByRole('button', { name: 'Save Home', exact: true }).click();
  await expect(page.getByText('Home saved.', { exact: true })).toBeVisible();
  expect(
    (
      await request.put(endpoint, {
        headers,
        data: { placeId: 'synthetic-work', expectedPlaceId: 'synthetic-home' },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole('button', { name: 'Remove Home', exact: true }).click();
  await expect(page.getByText(/Reload to check the latest saved values/)).toBeVisible();
  await page.getByRole('button', { name: 'Load saved places', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Home', exact: true }).click();
  await expect(page.getByText('Home removed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toHaveCount(0);
  const response = await request.get('http://localhost:4085/v1/saved-places', { headers });
  expect((await response.json()).places).not.toContainEqual(expect.objectContaining({ kind: 'home' }));
});

test('Saved-place search discards delayed results and recovers from provider failure', async ({ page }) => {
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Saved places', exact: true }).click();
  const address = page.getByRole('textbox', { name: 'Saved place address', exact: true });
  const search = page.getByRole('button', { name: 'Search places', exact: true });
  let release!: () => void;
  let started!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/v1/places?q=Home', async (route) => {
    const response = await route.fetch();
    started();
    await delayed;
    await route.fulfill({ response });
  });
  await address.fill('Home');
  await search.click();
  await intercepted;
  await address.fill('Work');
  release();
  await search.click();
  await page.getByRole('button', { name: 'Work · synthetic destination', exact: true }).click();
  await expect(page.getByText('Selected: Work · synthetic destination', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Home · synthetic pickup', exact: true })).toHaveCount(0);
  await address.fill('Unavailable');
  await expect(page.getByText(/^Selected:/)).toHaveCount(0);
  await page.route('**/v1/places?q=Unavailable', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'PROVIDER_ERROR', message: 'private-provider-debug-detail' } }),
    }),
  );
  await search.click();
  await expect(
    page.getByText('Places could not be loaded. Please try again.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('private-provider-debug-detail')).toHaveCount(0);
  await address.fill('Work');
  await search.click();
  await expect(page.getByRole('button', { name: 'Work · synthetic destination', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/rove-account-saved-places.png', fullPage: true });
});
