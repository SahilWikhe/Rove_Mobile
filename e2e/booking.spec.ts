import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

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
async function reviewRebooking(page: Page, previousId: string) {
  let requests = 0;
  const count = (sent: import('@playwright/test').Request) => {
    if (sent.method() === 'POST' && sent.url().endsWith('/v1/ride-requests')) requests++;
  };
  page.on('request', count);
  await expect(page.getByText('Ride details', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Book this trip again', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/book\\?fromRide=' + previousId));
  await expect(page.getByRole('button', { name: 'Change pickup', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change destination', exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'See your fare', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toBeVisible();
  expect(requests).toBe(0);
  page.off('request', count);
}

test('rider reviews a quote and explicitly confirms cancellation', async ({ page, request }) => {
  await routeAndQuote(page);
  await page.getByRole('button', { name: 'Request ride', exact: true }).click();
  await expect(page.getByText('Finding your ride.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: 'test-results/rider-finding.png' });
  await page.getByRole('button', { name: 'Show ride details', exact: true }).click();
  await expect(page.getByText('FARE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide ride details', exact: true }).click();
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
  // Losing the authoritative read invalidates an open confirmation. A recovered read
  // must require a new deliberate confirmation instead of reviving the old one.
  await page.getByRole('button', { name: 'Cancel ride', exact: true }).click();
  await expect(page.getByText('Cancel this ride?', { exact: true })).toBeVisible();
  await page.route(rideUrl, (route) => route.abort('failed'));
  await expect(page.getByRole('button', { name: 'Cancel ride', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirm cancellation', exact: true })).toHaveCount(0);
  const duringFailure = await request.get(rideUrl, {
    headers: { Authorization: 'Bearer synthetic-rider' },
  });
  expect((await duringFailure.json()).state).toBe('searching');
  await page.unroute(rideUrl);
  await expect(page.getByRole('button', { name: 'Cancel ride', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Confirm cancellation', exact: true })).toHaveCount(0);
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
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'My rides', exact: true }).click();
  const historyCard = page.getByTestId(`rider-history-${id}`);
  await expect(historyCard).toBeVisible();
  await expect(historyCard.getByText('cancelled', { exact: true })).toBeVisible();
  await expect(historyCard.getByText(/^Requested /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/rove-rider-history-figma-web.png', fullPage: true });
  await historyCard.click();
  await expect(page).toHaveURL(new RegExp(`/ride\\?id=${id}`));
  await reviewRebooking(page, id!);
});
test('rider request reaches the driver and both apps follow a completed synthetic trip', async ({
  page,
  browser,
  request,
}) => {
  // Includes settlement, receipt recovery, support submission and rebooking across both apps.
  test.setTimeout(90000);
  let locationEvents = 0;
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      try {
        if (JSON.parse(String(payload)).type === 'driver.location.changed') locationEvents++;
      } catch {
        /* Ignore protocol frames. */
      }
    }),
  );
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
    await expect(driver.getByText('TRIP MAP', { exact: true })).toHaveCount(0);
    const acceptanceKeys: string[] = [];
    let dropAcceptance = true;
    await driver.route('**/v1/offers/*/accept', async (route) => {
      acceptanceKeys.push(route.request().headers()['idempotency-key']!);
      if (dropAcceptance) {
        dropAcceptance = false;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });
    await driver.getByRole('button', { name: 'Accept ride', exact: true }).click();
    await expect(driver.getByRole('button', { name: 'Check acceptance result', exact: true })).toBeVisible();
    // Synthetic browser credentials are memory-only; sign back in after the restart.
    await driver.goto('http://localhost:8092');
    await driver.getByRole('button', { name: 'Get started', exact: true }).click();
    await driver.getByRole('button', { name: 'Check previous acceptance', exact: true }).click();
    await driver.getByRole('button', { name: 'Check acceptance result', exact: true }).click();
    await expect.poll(() => acceptanceKeys.length).toBe(2);
    expect(new Set(acceptanceKeys).size).toBe(1);

    await expect(driver.getByText('TRIP MAP', { exact: true })).toBeVisible();
    const locationUrl = 'http://localhost:4085/v1/rides/' + id + '/driver-location';
    await expect
      .poll(async () => {
        const response = await request.get(locationUrl, {
          headers: { Authorization: 'Bearer synthetic-rider' },
        });
        return (await response.json()).location !== null;
      })
      .toBe(true);
    await page.bringToFront();
    await expect(page.getByText('Pickup · now', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to rides', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Your account', exact: true })).toBeVisible();
    await expect(page.getByText('YOUR DRIVER', { exact: true })).toBeVisible();
    await expect(page.getByText('Plate: DEMO', { exact: true })).toBeVisible();
    await expect(page.getByText(/Driver location last reported at/)).toBeVisible();
    // A location read failure must remove the previously visible report.
    await page.route(locationUrl, (route) => route.abort('failed'));
    await expect(
      page.getByText('Driver location is unavailable. Check your trip status or contact support.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/Driver location last reported at/)).toHaveCount(0);
    await page.unroute(locationUrl);
    // Use explicit moving GPS samples instead of the browser's fixed synthetic heartbeat.
    await driver.route('**/v1/drivers/me/heartbeat', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true }),
      }),
    );
    async function verifyMovingLocation(latitude: number, longitude: number) {
      await page.bringToFront();
      const headers = { Authorization: 'Bearer synthetic-driver' };
      const profile = await (await request.get('http://localhost:4085/v1/drivers/me', { headers })).json();
      const update = page.waitForResponse(
        async (response) =>
          response.url() === locationUrl &&
          response.ok() &&
          (await response.json()).location?.coordinate.latitude === latitude,
      );
      const priorEvents = locationEvents;
      const uploaded = await request.post('http://localhost:4085/v1/drivers/me/heartbeat', {
        headers,
        data: {
          coordinate: { latitude, longitude },
          sampledAt: new Date().toISOString(),
          accuracyMeters: 5,
          sequence: profile.locationSequence + 1,
        },
      });
      expect(uploaded.ok()).toBe(true);
      await expect.poll(() => locationEvents, { timeout: 3000 }).toBeGreaterThan(priorEvents);
      await update;
      await expect(page.getByText(/Driver location last reported at/)).toBeVisible();
    }
    await driver.bringToFront();
    await driver.evaluate(() => {
      window.open = (url) => {
        document.documentElement.dataset.navigationUrl = String(url);
        return null;
      };
    });
    for (const action of ['Head to pickup', 'I’ve arrived', 'Start trip', 'Complete trip']) {
      if (action === 'I’ve arrived') {
        await verifyMovingLocation(35.785, -78.642);
        await driver.bringToFront();
        await expect(driver.getByText('Alex Rider', { exact: true })).toBeVisible();
        await expect(driver.getByText('Home · synthetic pickup', { exact: true })).toBeVisible();
        await driver.screenshot({ path: '/tmp/rove-active-pickup-web.png', fullPage: true });
      }
      if (action === 'Complete trip') {
        await expect(driver.getByText('DROPPING OFF AT', { exact: true })).toBeVisible();
        await expect(driver.getByText('Work · synthetic destination', { exact: true })).toBeVisible();
        await driver.screenshot({ path: '/tmp/rove-active-dropoff-web.png', fullPage: true });
        await page.bringToFront();
        await expect(page.getByText('Ride · now', { exact: true })).toBeVisible();
        await verifyMovingLocation(35.81, -78.635);
        await page.screenshot({ path: test.info().outputPath('rider-tracking.png'), fullPage: true });
        await driver.bringToFront();
      }
      await expect(driver.getByRole('button', { name: action, exact: true })).toBeVisible();
      await expect(driver.getByRole('button', { name: action, exact: true })).toBeInViewport();
      const leg = action === 'Complete trip' ? 'destination' : 'pickup';
      const before = await request.get('http://localhost:4085/v1/rides/' + id, {
        headers: { Authorization: 'Bearer synthetic-driver' },
      });
      const trip = await before.json();
      await driver.evaluate(() => {
        delete document.documentElement.dataset.navigationUrl;
      });
      await driver.getByRole('button', { name: 'Directions to ' + leg, exact: true }).click();
      await expect(driver).toHaveURL(new RegExp('/navigation\\?id=' + id));
      await expect(
        driver.getByText('Turn-by-turn directions are available in the Rove Driver iOS and Android apps.'),
      ).toBeVisible();
      expect(await driver.evaluate(() => document.documentElement.dataset.navigationUrl)).toBeUndefined();
      await driver.getByRole('button', { name: 'Back to trip', exact: true }).click();
      await expect(driver.getByRole('button', { name: action, exact: true })).toBeVisible();
      const after = await request.get('http://localhost:4085/v1/rides/' + id, {
        headers: { Authorization: 'Bearer synthetic-driver' },
      });
      expect((await after.json()).state).toBe(trip.state);

      await driver.getByRole('button', { name: action, exact: true }).click();
      if (action === 'Head to pickup') {
        const tripUrl = 'http://localhost:4085/v1/rides/' + id;
        await driver.route(tripUrl, (route) => route.abort('failed'));
        await expect(
          driver.getByRole('button', { name: 'Confirm: Head to pickup', exact: true }),
        ).toHaveCount(0);
        await expect(driver.getByRole('button', { name: 'Head to pickup', exact: true })).toHaveCount(0);
        await driver.unroute(tripUrl);
        await driver.getByRole('button', { name: 'Head to pickup', exact: true }).click();
        // Another signed-in device advances the trip while this confirmation is open.
        const advanced = await request.post('http://localhost:4085/v1/rides/' + id + '/transitions', {
          headers: { Authorization: 'Bearer synthetic-driver', 'Idempotency-Key': crypto.randomUUID() },
          data: { state: 'en_route', expectedVersion: trip.version },
        });
        expect(advanced.ok()).toBe(true);
        await expect(driver.getByRole('button', { name: 'I’ve arrived', exact: true })).toBeVisible();
        await expect(driver.getByRole('button', { name: 'Confirm: I’ve arrived', exact: true })).toHaveCount(
          0,
        );
        await expect(
          driver.getByRole('button', { name: 'Confirm: Head to pickup', exact: true }),
        ).toHaveCount(0);
      } else {
        await driver.getByRole('button', { name: 'Confirm: ' + action, exact: true }).click();
      }
    }
    await expect(driver.getByRole('button', { name: 'Back to driving', exact: true })).toBeVisible();
    await expect(driver.getByText('TRIP MAP', { exact: true })).toHaveCount(0);
    await expect(driver.getByRole('button', { name: /Directions to/ })).toHaveCount(0);
    await page.bringToFront();
    await expect(page.getByText('You’ve arrived.', { exact: true })).toBeVisible();
    await expect(page.getByText('YOUR DRIVER', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Plate: DEMO', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Ride · now', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText('Your payment is recorded. View your receipt below.', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/rove-rider-completed-web.png', fullPage: true });
    const saved = await request.get('http://localhost:4085/v1/rides/' + id, {
      headers: { Authorization: 'Bearer synthetic-rider' },
    });
    expect((await saved.json()).state).toBe('completed');
    const revoked = await request.get(locationUrl, { headers: { Authorization: 'Bearer synthetic-rider' } });
    expect(revoked.status()).toBe(404);
    await expect(page.getByText(/Driver location last reported at/)).toHaveCount(0);
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
    ).toHaveCount(0);
    await expect(page.getByText('Payment: paid', { exact: true }).filter({ visible: true })).toBeVisible();
    const receiptUrl = 'http://localhost:4085/v1/rides/' + id + '/receipt';
    await page.route(receiptUrl, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: 'Receipt access unavailable.',
            requestId: 'synthetic-receipt',
          },
        }),
      }),
    );
    await expect(page.getByText('Receipt access unavailable.', { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText('Receipt reference', { exact: true }).filter({ visible: true })).toHaveCount(
      0,
    );
    await expect(page.getByText('AMOUNT CAPTURED', { exact: true }).filter({ visible: true })).toHaveCount(0);
    await page.unroute(receiptUrl);
    await page.getByRole('button', { name: 'Retry receipt', exact: true }).click();
    await expect(
      page.getByText('Receipt reference', { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry receipt', exact: true })).toHaveCount(0);
    const receipt = await request.get('http://localhost:4085/v1/rides/' + id + '/receipt', {
      headers: { Authorization: 'Bearer synthetic-rider' },
    });
    expect((await receipt.json()).capturedAmount).toEqual({ amount: 1185, currency: 'USD' });
    await page.getByRole('button', { name: 'Back to ride', exact: true }).click();
    await page.getByRole('button', { name: 'Get help with this ride', exact: true }).click();
    await expect(page.getByText(`Ride reference: ${id}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trip · Selected', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'What do you need help with?', exact: true })).toHaveValue(
      '',
    );
    await expect(page.getByRole('button', { name: 'Send support request', exact: true })).toBeDisabled();
    await page
      .getByRole('textbox', { name: 'What do you need help with?', exact: true })
      .fill('Please review this synthetic trip.');
    await page.getByRole('button', { name: 'Send support request', exact: true }).click();
    await expect(page.getByText(/Request saved. Reference:/)).toBeVisible();
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Get help with this ride', exact: true })).toBeVisible();
    const supportRideUrl = 'http://localhost:4085/v1/rides/' + id;
    await page.route(supportRideUrl, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'FORBIDDEN', message: 'Ride access unavailable.', requestId: 'synthetic-support' },
        }),
      }),
    );
    await page.getByRole('button', { name: 'Get help with this ride', exact: true }).click();
    await expect(
      page.getByText('This ride could not be verified. Retry or open general support.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send support request', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open general support', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'What do you need help with?', exact: true })).toHaveValue(
      '',
    );
    await page.unroute(supportRideUrl);
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await reviewRebooking(page, id!);
    const earnings = await request.get('http://localhost:4085/v1/drivers/me/earnings/' + id, {
      headers: { Authorization: 'Bearer synthetic-driver' },
    });
    expect(earnings.ok()).toBe(true);
    const tripEarnings = await earnings.json();
    expect(tripEarnings.recordedAmount).toEqual(tripEarnings.estimatedAmount);
    expect(tripEarnings.recordedAmount.amount).toBeGreaterThan(0);
    expect(tripEarnings.payoutStatus).toBe('not_configured');
    await driver.bringToFront();
    await expect(
      driver.getByText('RECORDED TRIP EARNINGS', { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      driver.getByText('Synthetic earnings · no money will be paid out.', { exact: true }),
    ).toHaveCount(0);
    await driver.getByRole('button', { name: 'View earnings', exact: true }).click();
    await expect(driver.getByRole('tab', { name: 'Last 7 days', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const today = new Date().toISOString().slice(0, 10);
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
      tripEarnings.recordedAmount.amount / 100,
    );
    await expect(
      driver.getByRole('img', { name: `${today}, ${amount} recorded earnings`, exact: true }),
    ).toBeVisible();
    await driver.screenshot({ path: '/tmp/rove-driver-chart-paid-web.png', fullPage: true });
    const earning = driver.getByTestId('earning-' + id);
    await expect(earning).toBeVisible();
    await earning.locator('..').getByRole('button', { name: 'View trip details', exact: true }).click();
    await expect(driver).toHaveURL(new RegExp('/trip\\?id=' + id));
    await expect(
      driver.getByText('RECORDED TRIP EARNINGS', { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await driver.goBack();
    await driver.getByRole('button', { name: 'Review payout setup', exact: true }).click();
    await expect(driver.getByText('Your payout details.', { exact: true })).toBeVisible();
    await driver.goBack();
    await driver.goBack();
    await driver.getByRole('button', { name: 'Back to driving', exact: true }).click();
    await driver.getByRole('button', { name: 'Go offline', exact: true }).click();
    await driver.getByRole('button', { name: 'Trips', exact: true }).click();
    const historyTrip = driver.getByTestId('driver-trip-' + id);
    await expect(historyTrip).toBeVisible();
    await expect(historyTrip.getByText('completed', { exact: true })).toBeVisible();
    await driver.screenshot({ path: '/tmp/rove-driver-trips-figma-web.png', fullPage: true });
    await historyTrip.click();
    await expect(driver).toHaveURL(new RegExp('/trip\\?id=' + id));
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
