import { expect, test } from './fixtures';

for (const [role, port] of [
  ['rider', 8091],
  ['driver', 8092],
] as const) {
  test(`${role} signed-out message links recover through account setup without private thread requests`, async ({
    page,
  }) => {
    const threadRequests: string[] = [];
    await page.route('**/v1/conversations/**', async (route) => {
      threadRequests.push(route.request().url());
      await route.abort();
    });
    await page.goto(`http://localhost:${port}/messages`);
    await expect(page.getByText('Sign in to view messages', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to your account' })).toBeVisible();
    await page.goto(`http://localhost:${port}/conversation?id=00000000-0000-4000-8000-000000000001`);
    await expect(page.getByText('Sign in to view this conversation', { exact: true })).toBeVisible();
    expect(threadRequests).toEqual([]);
    await page.getByRole('button', { name: 'Continue to your account' }).click();
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: role === 'rider' ? 'Where are you going?' : 'Open your account',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Messages(?:,.*)?$/ }).click();
    await expect(
      page.getByText(role === 'rider' ? 'Drivers from your rides' : 'Riders from your trips', {
        exact: true,
      }),
    ).toBeVisible();
  });
}
