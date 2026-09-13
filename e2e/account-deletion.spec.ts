import { expect, test } from './fixtures';

for (const [role, port] of [
  ['rider', 8091],
  ['driver', 8092],
] as const) {
  test(`${role}: deletion requires confirmation and a lost response does not duplicate the request`, async ({
    page,
    request,
  }) => {
    let drop = true;
    const keys: string[] = [];
    await page.route('**/v1/support-requests', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      expect(route.request().postDataJSON()).toMatchObject({ deletionConsent: 'account-deletion-v1' });
      keys.push(route.request().headers()['idempotency-key']!);
      if (drop) {
        drop = false;
        expect((await route.fetch()).ok()).toBe(true);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`http://localhost:${port}`);
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('button', { name: 'Request account deletion', exact: true }).click();
    await expect(page.getByText(/Your account remains active while the request is reviewed/)).toBeVisible();
    expect(keys).toHaveLength(0);
    await page.route('**/v1/account-deletion', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Deletion status temporarily unavailable.' } },
      }),
    );
    await page.getByRole('button', { name: 'Load / refresh my requests', exact: true }).click();
    await expect(page.getByText('Deletion status temporarily unavailable.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send deletion request', exact: true })).toHaveCount(0);
    await page.unroute('**/v1/account-deletion');
    await page.getByRole('button', { name: 'Load / refresh my requests', exact: true }).click();
    const send = page.getByRole('button', { name: 'Send deletion request', exact: true });
    await send.click();
    await expect(
      page.getByText('Connection interrupted. Refresh before trying again.', { exact: true }),
    ).toBeVisible();
    await send.click();
    await expect(page.getByText(/Request saved. Reference:/)).toBeVisible();
    await expect(send).toHaveCount(0);
    await expect(page.getByText('Deletion request received', { exact: true })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await page.getByRole('button', { name: 'Request account deletion', exact: true }).click();
    await expect(page.getByText('Deletion request received', { exact: true })).toBeVisible();
    await expect(send).toHaveCount(0);
    expect(keys).toHaveLength(2);
    await page.screenshot({ path: `reports/${role}-deletion-received.png`, fullPage: true });
    const response = await request.get('http://localhost:4085/v1/support-requests', {
      headers: { Authorization: `Bearer synthetic-${role}` },
    });
    expect(response.ok()).toBe(true);
    const requests = (await response.json()).requests.filter((entry: { message: string }) =>
      entry.message.startsWith('Please delete my Rove account'),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ category: 'account', status: 'open' });
    const deletion = await request.get('http://localhost:4085/v1/account-deletion', {
      headers: { Authorization: `Bearer synthetic-${role}` },
    });
    expect(deletion.ok()).toBe(true);
    expect((await deletion.json()).request).toMatchObject({
      supportRequestId: requests[0].id,
      consentVersion: 'account-deletion-v1',
      state: 'requested',
    });
    await page.unroute('**/v1/support-requests');
    await page.route('**/v1/support-requests', (route) =>
      route.fulfill({
        json: {
          requests: [
            {
              ...requests[0],
              status: 'resolved',
              response: 'Please contact support about the remaining account steps.',
              resolvedAt: '2026-09-12T12:00:00.000Z',
            },
          ],
        },
      }),
    );
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await page.getByRole('button', { name: 'Request account deletion', exact: true }).click();
    await expect(page.getByText('Deletion request received', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send deletion request', exact: true })).toHaveCount(0);
    await expect(
      page.getByText('Please contact support about the remaining account steps.', { exact: true }),
    ).toBeVisible();
    await page.route('**/v1/account-deletion', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Deletion status temporarily unavailable.' } },
      }),
    );
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await page.getByRole('button', { name: 'Request account deletion', exact: true }).click();
    await expect(page.getByText('Deletion status temporarily unavailable.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send deletion request', exact: true })).toHaveCount(0);
  });
}

for (const port of [8091, 8092]) {
  test(`signed-out deletion link on ${port} offers account recovery without private requests`, async ({
    page,
  }) => {
    let privateRequests = 0;
    await page.route('**/v1/support-requests', async (route) => {
      privateRequests++;
      await route.abort();
    });
    await page.goto(`http://localhost:${port}/account-deletion`);
    await expect(page.getByText('Sign in to manage your deletion request', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send deletion request', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue to your account', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible();
    expect(privateRequests).toBe(0);
  });
}
