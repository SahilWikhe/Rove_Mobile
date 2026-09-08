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
  const rideUrl = 'http://localhost:4085/v1/rides/' + id;
  await expect
    .poll(async () => {
      const response = await request.get(rideUrl, {
        headers: { Authorization: 'Bearer synthetic-rider' },
      });
      return (await response.json()).version;
    })
    .toBeGreaterThan(1);
  let cancellationRequests = 0;
  await page.route(rideUrl + '/transitions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    cancellationRequests++;
    if (cancellationRequests === 1) {
      // Deliver an outdated confirmation to the real API; its version check must reject it.
      const response = await route.fetch({
        postData: { ...route.request().postDataJSON(), expectedVersion: 1 },
      });
      expect(response.status()).toBe(409);
      expect((await response.json()).error.code).toBe('STALE_RIDE');
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Cancel ride', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(
    page.getByText('Your trip changed. Review the latest details and confirm cancellation again.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm cancellation', exact: true })).toHaveCount(0);
  expect(cancellationRequests).toBe(1);
  const unchanged = await request.get(rideUrl, {
    headers: { Authorization: 'Bearer synthetic-rider' },
  });
  expect((await unchanged.json()).state).toBe('searching');
  await cancelWithReconfirmation(page);
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
    await expect
      .poll(async () => {
        const receipt = await request.get('http://localhost:4085/v1/rides/' + id + '/receipt', {
          headers: { Authorization: 'Bearer synthetic-rider' },
        });
        return receipt.status();
      })
      .toBe(200);
    await page.getByRole('button', { name: 'View receipt', exact: true }).click();
    await expect(page.getByText('Your payment record.', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Synthetic payment record · no money was charged.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Payment: paid', { exact: true }).filter({ visible: true })).toBeVisible();
    const receipt = await request.get('http://localhost:4085/v1/rides/' + id + '/receipt', {
      headers: { Authorization: 'Bearer synthetic-rider' },
    });
    expect((await receipt.json()).capturedAmount).toEqual({ amount: 1185, currency: 'USD' });
    const earnings = await request.get('http://localhost:4085/v1/drivers/me/earnings/' + id, {
      headers: { Authorization: 'Bearer synthetic-driver' },
    });
    expect(earnings.ok()).toBe(true);
    const tripEarnings = await earnings.json();
    expect(tripEarnings.recordedAmount).toEqual(tripEarnings.estimatedAmount);
    expect(tripEarnings.recordedAmount.amount).toBeGreaterThan(0);
    expect(tripEarnings.payoutStatus).toBe('not_configured');
    await driver.bringToFront();
    await expect(driver.getByText('RECORDED TRIP EARNINGS', { exact: true })).toBeVisible();
    await expect(
      driver.getByText('Synthetic earnings · no money will be paid out.', { exact: true }),
    ).toBeVisible();
    await driver.getByRole('button', { name: 'View earnings', exact: true }).click();
    await expect(driver.getByText('Your work. Recorded.', { exact: true })).toBeVisible();
    await expect(driver.getByText('Trip reference ' + id, { exact: true })).toBeVisible();
    await driver.goBack();
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
  await cancelWithReconfirmation(page);
});

async function cancelWithReconfirmation(page: Page) {
  const cancelled = page.getByText('Ride cancelled.', { exact: true });
  const changed = page.getByText(
    'Your trip changed. Review the latest details and confirm cancellation again.',
    { exact: true },
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Cancel ride', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(cancelled.or(changed)).toBeVisible();
    if (await cancelled.isVisible()) return;
    // Explicitly review/reconfirm after a real version change; never bypass backend concurrency checks.
  }
  await expect(cancelled).toBeVisible();
}

test('an unmatched search expires and retry requires a fresh quote and confirmation', async ({
  page,
  request,
}) => {
  test.setTimeout(260000);
  await routeAndQuote(page);
  await page.getByRole('button', { name: 'Request ride', exact: true }).click();
  await expect(page.getByText('Finding your ride.', { exact: true })).toBeVisible();
  const previousId = new URL(page.url()).searchParams.get('id');
  await expect(page.getByText('No drivers available right now.', { exact: true })).toBeVisible({
    timeout: 210000,
  });
  const headers = { Authorization: 'Bearer synthetic-rider' };
  const previous = await request.get('http://localhost:4085/v1/rides/' + previousId, { headers });
  expect((await previous.json()).state).toBe('no_driver_found');
  let bookingPosts = 0;
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && sent.url().endsWith('/v1/ride-requests')) bookingPosts++;
  });
  await page.getByRole('button', { name: 'Try a new search', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change pickup', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change destination', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Standard', exact: true })).toBeChecked();
  expect(bookingPosts).toBe(0);
  await page.getByRole('button', { name: 'See your fare', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toBeVisible();
  expect(bookingPosts).toBe(0);
  await page.getByRole('button', { name: 'Request ride', exact: true }).click();
  await expect(page.getByText('Finding your ride.', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('id')).not.toBe(previousId);
  expect(bookingPosts).toBe(1);
  await cancelWithReconfirmation(page);
});
