import { expect, test, type Page } from '@playwright/test';

async function routeAndQuote(page: Page) {
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Where are you going?', exact: true }).click();
  await page.getByRole('textbox', { name: 'Pickup address', exact: true }).fill('Home');
  await page.getByRole('button', { name: 'Search places', exact: true }).click();
  await page.getByRole('button', { name: 'Home · synthetic pickup', exact: true }).click();
  await page.getByRole('textbox', { name: 'Destination address', exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Search places', exact: true }).click();
  await page.getByRole('button', { name: 'Work · synthetic destination', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Standard', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'See your fare', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toBeVisible();
}
test('rider reviews a quote and explicitly confirms cancellation', async ({ page, request }) => {
  await routeAndQuote(page);
  await page.getByRole('button', { name: 'Request ride', exact: true }).click();
  await expect(page.getByText('Finding your ride.', { exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get('id');
  expect(id).toBeTruthy();
  await page.getByRole('button', { name: 'Cancel ride', exact: true }).click();
  await expect(page.getByText('Cancel this ride?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep ride', exact: true }).click();
  await expect(page.getByText('Finding your ride.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel ride', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(page.getByText('Ride cancelled.', { exact: true })).toBeVisible();
  const saved = await request.get('http://localhost:4085/v1/rides/' + id, {
    headers: { Authorization: 'Bearer synthetic-rider' },
  });
  expect((await saved.json()).state).toBe('cancelled');
});
test('rider request reaches the driver and both apps follow a completed synthetic trip', async ({
  page,
  browser,
  request,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const driver = await context.newPage();
  try {
    await driver.goto('http://localhost:8092');
    await driver.getByRole('button', { name: 'Get started', exact: true }).click();
    await driver.getByRole('button', { name: 'Go online', exact: true }).click();
    await expect(driver.getByRole('button', { name: 'Go offline', exact: true })).toBeVisible();
    await routeAndQuote(page);
    await page.getByRole('button', { name: 'Request ride', exact: true }).click();
    await expect(page.getByText('Finding your ride.', { exact: true })).toBeVisible();
    const id = new URL(page.url()).searchParams.get('id');
    await driver.bringToFront();
    await driver.getByRole('button', { name: 'View ride request', exact: true }).click();
    await expect(driver.getByText('Home · synthetic pickup', { exact: true })).toHaveCount(0);
    await expect(driver.getByText('Alex Rider', { exact: true })).toHaveCount(0);
    await driver.getByRole('button', { name: 'Accept ride', exact: true }).click();
    for (const action of ['Head to pickup', 'I’ve arrived', 'Start trip', 'Complete trip']) {
      await driver.getByRole('button', { name: action, exact: true }).click();
      await driver.getByRole('button', { name: 'Confirm: ' + action, exact: true }).click();
    }
    await expect(driver.getByRole('button', { name: 'Back to driving', exact: true })).toBeVisible();
    await page.bringToFront();
    await expect(page.getByText('You’ve arrived.', { exact: true })).toBeVisible();
    const saved = await request.get('http://localhost:4085/v1/rides/' + id, {
      headers: { Authorization: 'Bearer synthetic-rider' },
    });
    expect((await saved.json()).state).toBe('completed');
    await driver.getByRole('button', { name: 'Back to driving', exact: true }).click();
    await driver.getByRole('button', { name: 'Go offline', exact: true }).click();
  } finally {
    await context.close();
  }
});

test('lost booking response recovers the original ride instead of creating another', async ({
  page,
  request,
}) => {
  await routeAndQuote(page);
  const before = await request.get('http://localhost:4085/v1/rides', {
    headers: { Authorization: 'Bearer synthetic-rider' },
  });
  const beforeIds = (await before.json()).rides.map((ride: { id: string }) => ride.id);
  let committedId: string | undefined;
  await page.route('http://localhost:4085/v1/ride-requests', async (route) => {
    if (route.request().method() === 'POST' && !committedId) {
      // Commit through the real API, then deliberately discard its response at the browser boundary.
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committedId = (await response.json()).id;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Request ride', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check booking result', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check booking result', exact: true }).click();
  await expect(page.getByText('Finding your ride.', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('id')).toBe(committedId);
  const after = await request.get('http://localhost:4085/v1/rides', {
    headers: { Authorization: 'Bearer synthetic-rider' },
  });
  const newRides = (await after.json()).rides.filter((ride: { id: string }) => !beforeIds.includes(ride.id));
  expect(newRides.map((ride: { id: string }) => ride.id)).toEqual([committedId]);
  await page.getByRole('button', { name: 'Cancel ride', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(page.getByText('Ride cancelled.', { exact: true })).toBeVisible();
});
