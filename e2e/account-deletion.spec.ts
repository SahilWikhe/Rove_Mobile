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
    const send = page.getByRole('button', { name: 'Send deletion request', exact: true });
    await send.click();
    await expect(
      page.getByText('Connection interrupted. Refresh before trying again.', { exact: true }),
    ).toBeVisible();
    await send.click();
    await expect(page.getByText(/Request saved. Reference:/)).toBeVisible();
    await expect(send).toBeDisabled();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await page.getByRole('button', { name: 'Request account deletion', exact: true }).click();
    await page.getByRole('button', { name: 'Send deletion request', exact: true }).click();
    await expect(page.getByText(/Request saved. Reference:/)).toBeVisible();
    const response = await request.get('http://localhost:4085/v1/support-requests', {
      headers: { Authorization: `Bearer synthetic-${role}` },
    });
    expect(response.ok()).toBe(true);
    const requests = (await response.json()).requests.filter((entry: { message: string }) =>
      entry.message.startsWith('Please delete my Rove account'),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ category: 'account', status: 'open' });
  });
}
