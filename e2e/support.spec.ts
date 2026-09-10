import { expect, test } from './fixtures';

for (const [app, port] of [
  ['rider', 8091],
  ['driver', 8092],
] as const) {
  test(`${app}: support request persists through navigation without duplicate submission`, async ({
    page,
    request,
  }) => {
    const keyWarnings: string[] = [];
    page.on('console', (entry) => {
      if (entry.type() === 'error' && entry.text().includes('same key')) keyWarnings.push(entry.text());
    });
    const message = `Synthetic ${app} browser support question`;
    await page.goto(`http://localhost:${port}`);
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await expect(
      page.getByText('Push notifications are not available in this build yet.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toHaveCount(0);
    expect(keyWarnings).toEqual([]);
    await page.getByRole('button', { name: 'Help & support', exact: true }).click();
    await page.getByRole('button', { name: 'Load / refresh my requests', exact: true }).click();
    await expect(page.getByText('No requests yet.', { exact: true })).toBeVisible();
    const submit = page.getByRole('button', { name: 'Send support request', exact: true });
    await expect(submit).toBeDisabled();
    await page.getByRole('textbox', { name: 'What do you need help with?', exact: true }).fill(message);
    await submit.click();
    await expect(page.getByText(/Request saved\. Reference:/)).toBeVisible();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    // Simulate returning later through actual navigation, not a mocked response.
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await expect(
      page.getByText('Push notifications are not available in this build yet.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toHaveCount(0);
    expect(keyWarnings).toEqual([]);
    await page.getByRole('button', { name: 'Help & support', exact: true }).click();
    await page.getByRole('button', { name: 'Load / refresh my requests', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'What do you need help with?', exact: true }).fill(message);
    await page.getByRole('button', { name: 'Send support request', exact: true }).click();
    await expect(page.getByText(/Request saved\. Reference:/)).toBeVisible();
    const result = await request.get('http://localhost:4085/v1/support-requests', {
      headers: { Authorization: `Bearer synthetic-${app}` },
    });
    expect(result.ok()).toBe(true);
    const body = await result.json();
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].message).toBe(message);
    expect(body.requests[0].status).toBe('open');
  });
}
