import { expect, test } from './fixtures';
import { randomUUID } from 'node:crypto';
for (const [role, port] of [
  ['rider', 8091],
  ['driver', 8092],
] as const) {
  test(`${role}: notification devices require confirmation and protect refreshed registrations`, async ({
    page,
    request,
  }) => {
    const input = {
      installationId: randomUUID(),
      secret: 's'.repeat(43),
      mutationId: randomUUID(),
      expectedRevision: null,
      token: `ExpoPushToken[${randomUUID()}]`,
      platform: 'ios',
    };
    const headers = { Authorization: `Bearer synthetic-${role}` };
    const register = await request.put('http://localhost:4085/v1/push-installations', {
      headers,
      data: input,
    });
    expect(register.ok()).toBe(true);
    const devices = await (
      await request.get('http://localhost:4085/v1/me/notification-devices', { headers })
    ).json();
    const device = devices.devices.find((item: { revision: number }) => item.revision === 1);
    expect(device).toBeTruthy();
    const label = `iOS · ${device.id.slice(-6).toUpperCase()}`;
    await page.goto(`http://localhost:${port}`);
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('button', { name: 'Manage notification devices', exact: true }).click();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Turn off ${label}`, exact: true }).click();
    await page.getByRole('button', { name: 'Keep notifications', exact: true }).click();
    expect(
      (
        await (await request.get('http://localhost:4085/v1/me/notification-devices', { headers })).json()
      ).devices.some((item: { id: string }) => item.id === device.id),
    ).toBe(true);
    await page.getByRole('button', { name: `Turn off ${label}`, exact: true }).click();
    // Another device session refreshes the token after this screen captured its revision.
    expect(
      (
        await request.put('http://localhost:4085/v1/push-installations', {
          headers,
          data: { ...input, expectedRevision: 1, mutationId: randomUUID() },
        })
      ).ok(),
    ).toBe(true);
    await page.getByRole('button', { name: 'Confirm turn off', exact: true }).click();
    await expect(
      page.getByText('The change could not be confirmed. Retry, or refresh if this device changed.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Refresh devices', exact: true }).click();
    await page.getByRole('button', { name: `Turn off ${label}`, exact: true }).click();
    await page.getByRole('button', { name: 'Confirm turn off', exact: true }).click();
    await expect(page.getByText(`Notifications turned off for ${label}.`, { exact: true })).toBeVisible();
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    expect(
      (
        await (await request.get('http://localhost:4085/v1/me/notification-devices', { headers })).json()
      ).devices.some((item: { id: string }) => item.id === device.id),
    ).toBe(false);
  });
}
