import { expect, test } from './fixtures';

test('Home shortcut resolves an owned destination, requires route review and survives deletion', async ({
  page,
  request,
}) => {
  const headers = { Authorization: 'Bearer synthetic-rider' };
  const endpoint = 'http://localhost:4085/v1/saved-places/work';
  const save = await request.put(endpoint, {
    headers,
    data: { placeId: 'synthetic-work', expectedPlaceId: null },
  });
  expect(save.ok()).toBe(true);
  try {
    await page.goto('http://localhost:8091');
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Go to Work', exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/rove-home-saved-shortcuts.png', fullPage: true });
    await page.getByRole('button', { name: 'Go to Work', exact: true }).click();
    await expect(page.getByText('Destination: Work · synthetic destination', { exact: true })).toBeVisible();
    await expect(page.getByText('TRIP MAP', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toBeVisible();
    await expect(page.getByText('Loading your road route…')).toHaveCount(0);
    await page.screenshot({ path: '/tmp/rove-quote-map-preview.png', fullPage: true });
    // No submission: return Home and remove the slot behind its already-rendered shortcut.
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Go to Work', exact: true })).toBeVisible();
    expect(
      (await request.delete(endpoint, { headers, data: { expectedPlaceId: 'synthetic-work' } })).ok(),
    ).toBe(true);
    await page.getByRole('button', { name: 'Go to Work', exact: true }).click();
    await expect(page.getByText(/Your saved destination could not be loaded/)).toBeVisible();
    await expect(page.getByText('Confirm your ride', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Pickup address', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Set up Work', exact: true })).toBeVisible();
  } finally {
    await request.delete(endpoint, { headers, data: { expectedPlaceId: 'synthetic-work' } });
  }
});

test('Empty Work shortcut saves a place without entering booking and refreshes Home', async ({
  page,
  request,
}) => {
  const headers = { Authorization: 'Bearer synthetic-rider' };
  const endpoint = 'http://localhost:4085/v1/saved-places/work';
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Set up Work', exact: true }).click();
  await expect(page).toHaveURL(/\/saved-places$/);
  await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Saved place address', exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Search places', exact: true }).click();
  await page.getByRole('button', { name: 'Work · synthetic destination', exact: true }).click();
  try {
    await page.getByRole('button', { name: 'Save Work', exact: true }).click();
    await expect(page.getByText('Work saved.', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await page.getByRole('button', { name: 'Go to Work', exact: true }).click();
    await expect(page.getByText('Destination: Work · synthetic destination', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toBeVisible();
  } finally {
    await request.delete(endpoint, { headers, data: { expectedPlaceId: 'synthetic-work' } });
  }
});

test('saved shortcut keeps its destination when current pickup is unavailable', async ({ page, request }) => {
  const headers = { Authorization: 'Bearer synthetic-rider' };
  const endpoint = 'http://localhost:4085/v1/saved-places/work';
  await request.put(endpoint, { headers, data: { placeId: 'synthetic-work', expectedPlaceId: null } });
  try {
    await page.route('**/v1/places/current', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'MAPS_UNAVAILABLE', message: 'Enter your pickup address manually.' } },
      }),
    );
    await page.goto('http://localhost:8091');
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'Go to Work', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Pickup address', exact: true })).toBeVisible();
    await expect(page.getByText('Work · synthetic destination', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toHaveCount(0);
  } finally {
    await request.delete(endpoint, { headers, data: { expectedPlaceId: 'synthetic-work' } });
  }
});
