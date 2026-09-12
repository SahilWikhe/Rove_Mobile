import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
test('rider and driver exchange persisted messages, recover a lost send, and report a conversation', async ({
  page,
  browser,
  request,
}) => {
  const driverContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const driver = await driverContext.newPage();
  const uiErrors: string[] = [];
  const socketEvents = new Map([
    [page, [] as string[]],
    [driver, [] as string[]],
  ]);
  for (const surface of [page, driver])
    surface.on('websocket', (socket) => {
      if (!socket.url().endsWith('/v1/realtime')) return;
      socket.on('framereceived', ({ payload }) => {
        const event = JSON.parse(payload.toString()) as { type: string };
        socketEvents.get(surface)!.push(event.type);
      });
    });
  for (const surface of [page, driver])
    surface.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /Unexpected text node|Text strings must|Maximum update depth|Unable to resolve/.test(message.text())
      )
        uiErrors.push(message.text());
    });
  const api = 'http://localhost:4085',
    riderHeaders = { Authorization: 'Bearer synthetic-rider' },
    driverHeaders = { Authorization: 'Bearer synthetic-driver' };
  try {
    await driver.goto('http://localhost:8092');
    await driver.getByRole('button', { name: 'Get started', exact: true }).click();
    await driver.getByRole('button', { name: 'Go online', exact: true }).click();
    await expect(driver.getByRole('button', { name: 'Go offline', exact: true })).toBeVisible();
    const places = await (
      await request.get(api + '/v1/places?q=synthetic', { headers: riderHeaders })
    ).json();
    const quote = await (
      await request.post(api + '/v1/quotes', {
        headers: riderHeaders,
        data: { pickup: places.places[0], destination: places.places[1], service: 'standard' },
      })
    ).json();
    const booked = await request.post(api + '/v1/ride-requests', {
      headers: { ...riderHeaders, 'Idempotency-Key': randomUUID() },
      data: { quoteId: quote.id },
    });
    expect(booked.ok()).toBe(true);
    const ride = await booked.json();
    let offerId = '';
    await expect
      .poll(async () => {
        const data = await (
          await request.get(api + '/v1/drivers/me/offers', { headers: driverHeaders })
        ).json();
        offerId = data.offers[0]?.id ?? '';
        return !!offerId;
      })
      .toBe(true);
    const accepted = await request.post(api + '/v1/offers/' + offerId + '/accept', {
      headers: { ...driverHeaders, 'Idempotency-Key': randomUUID() },
      data: {},
    });
    expect(accepted.ok()).toBe(true);
    await driver.getByRole('button', { name: 'Messages', exact: true }).click();
    await driver.getByTestId(`conversation-${offerId}`).click();
    await expect(driver.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await expect.poll(() => socketEvents.get(driver)).toContain('ready');
    await expect(driver.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await driver.getByRole('button', { name: 'I’m outside now', exact: true }).click();
    await expect(driver.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'I’m outside now',
    );
    await expect(driver.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await expect(driver.getByRole('button', { name: 'Report conversation', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    let drop = true;
    const keys: string[] = [];
    await driver.route('**/v1/conversations/*/messages', async (route) => {
      keys.push(route.request().postDataJSON().requestId);
      if (drop) {
        drop = false;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });
    await driver.getByRole('textbox', { name: 'Message', exact: true }).fill('I am outside the entrance.');
    await driver.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(driver.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await driver.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(driver.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    const stored = await (
      await request.get(api + '/v1/conversations/' + offerId, { headers: riderHeaders })
    ).json();
    expect(stored.messages).toHaveLength(1);
    await expect(driver.getByLabel(/^You: I am outside the entrance\./)).toHaveCount(1);
    await page.goto('http://localhost:8091');
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'My rides', exact: true }).click();
    await page.getByTestId(`rider-history-${ride.id}`).click();
    await page.setViewportSize({ width: 320, height: 700 });
    const contact = page.getByRole('button', { name: 'Message driver', exact: true });
    await contact.scrollIntoViewIfNeeded();
    const contactBounds = await contact.boundingBox();
    expect(contactBounds).not.toBeNull();
    expect(contactBounds!.height).toBeGreaterThanOrEqual(48);
    expect(contactBounds!.x).toBeGreaterThanOrEqual(0);
    expect(contactBounds!.x + contactBounds!.width).toBeLessThanOrEqual(320);
    await page.screenshot({ path: 'test-results/rider-tracking-contact.png' });
    await contact.click();
    await expect(page.getByText('I am outside the entrance.', { exact: true })).toBeVisible();
    await expect.poll(() => socketEvents.get(page)).toContain('ready');
    await expect(page.getByLabel(/^[^:]+: I am outside the entrance\./)).toHaveCount(1);
    await expect(page.getByLabel(/^You: I am outside the entrance\./)).toHaveCount(0);
    const driverEventsBeforeReply = socketEvents.get(driver)!.length;
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Thank you, coming outside now.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await driver.bringToFront();
    await expect(driver.getByText('Thank you, coming outside now.', { exact: true })).toBeVisible();
    await expect
      .poll(() => socketEvents.get(driver)!.slice(driverEventsBeforeReply))
      .toContain('messages.changed');
    await driver.setViewportSize({ width: 320, height: 480 });
    const draft = driver.getByRole('textbox', { name: 'Message', exact: true });
    await draft.fill('Unsent pickup instructions');
    await driver.getByRole('button', { name: 'Report conversation', exact: true }).click();
    await expect(draft).toHaveCount(0);
    await expect(driver.getByRole('button', { name: 'Report conversation', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const keep = driver.getByRole('button', { name: 'Keep conversation', exact: true });
    await keep.scrollIntoViewIfNeeded();
    const bounds = await keep.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480);
    await keep.click();
    await expect(draft).toHaveValue('Unsent pickup instructions');
    await draft.fill('');
    await driver.setViewportSize({ width: 320, height: 700 });
    await driver.screenshot({ path: 'test-results/driver-message-thread.png' });
    await page.bringToFront();
    await page.screenshot({ path: 'test-results/rider-message-thread.png' });
    await page.getByRole('button', { name: 'Report conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Spam', exact: true }).click();
    await expect(page.getByText(/This conversation is closed after a report/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
    await driver.bringToFront();
    await expect(driver.getByText(/This conversation is closed after a report/)).toBeVisible();
    expect(uiErrors).toEqual([]);
    const latest = await (await request.get(api + '/v1/rides/' + ride.id, { headers: riderHeaders })).json();
    const cancel = await request.post(api + '/v1/rides/' + ride.id + '/transitions', {
      headers: { ...riderHeaders, 'Idempotency-Key': randomUUID() },
      data: { state: 'cancelled', expectedVersion: latest.version },
    });
    expect(cancel.ok()).toBe(true);
  } finally {
    await driverContext.close();
  }
});
