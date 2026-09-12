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
    const existingResponse = await request.get('http://localhost:4085/v1/support-requests', {
      headers: { Authorization: `Bearer synthetic-${app}` },
    });
    expect(existingResponse.ok()).toBe(true);
    const existing: { id: string; message: string }[] = (await existingResponse.json()).requests;
    await page.goto(`http://localhost:${port}`);
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(
      page.getByText('Push notifications are not available in this build yet.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    expect(keyWarnings).toEqual([]);
    await page.getByRole('button', { name: 'Help & support', exact: true }).click();
    if (existing.length === 0)
      await expect(page.getByText('No requests yet.', { exact: true })).toBeVisible();
    else
      for (const entry of existing)
        await expect(page.getByText(entry.message, { exact: true })).toBeVisible();
    const submit = page.getByRole('button', { name: 'Send support request', exact: true });
    await expect(submit).toBeDisabled();
    await page.getByRole('textbox', { name: 'What do you need help with?', exact: true }).fill(message);
    await submit.click();
    await expect(page.getByText(/Request saved\. Reference:/)).toBeVisible();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    // Simulate returning later through actual navigation, not a mocked response.
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(
      page.getByText('Push notifications are not available in this build yet.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    expect(keyWarnings).toEqual([]);
    await page.getByRole('button', { name: 'Help & support', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'What do you need help with?', exact: true }).fill(message);
    await page.getByRole('button', { name: 'Send support request', exact: true }).click();
    await expect(page.getByText(/Request saved\. Reference:/)).toBeVisible();
    const result = await request.get('http://localhost:4085/v1/support-requests', {
      headers: { Authorization: `Bearer synthetic-${app}` },
    });
    expect(result.ok()).toBe(true);
    const body = await result.json();
    expect(body.requests).toHaveLength(existing.length + 1);
    for (const entry of existing)
      expect(body.requests).toEqual(expect.arrayContaining([expect.objectContaining(entry)]));
    const created = body.requests.filter((entry: { message: string }) => entry.message === message);
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe('open');
  });
}

test('support recovers failed reads and a lost submission response without losing the draft or duplicating it', async ({
  page,
  request,
}) => {
  let failRead = true;
  let loseResponse = true;
  const submissionKeys: string[] = [];
  await page.route('**/v1/support-requests', async (route) => {
    if (route.request().method() === 'GET') {
      if (failRead) return route.abort();
      return route.continue();
    }
    if (route.request().method() === 'POST') {
      submissionKeys.push(route.request().headers()['idempotency-key']!);
      if (loseResponse) {
        loseResponse = false;
        const committed = await route.fetch();
        expect(committed.ok()).toBe(true);
        return route.abort();
      }
    }
    return route.continue();
  });
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Help & support', exact: true }).click();
  await expect(
    page.getByText('Connection interrupted. Refresh before trying again.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Loading your requests…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send support request', exact: true })).toHaveCount(0);
  failRead = false;
  const refresh = page.getByRole('button', { name: 'Load / refresh my requests', exact: true });
  await refresh.click();
  const draft = page.getByRole('textbox', { name: 'What do you need help with?', exact: true });
  const message = 'Synthetic support request with interrupted response';
  await draft.fill(message);
  failRead = true;
  await refresh.click();
  await expect(
    page.getByText('Connection interrupted. Refresh before trying again.', { exact: true }),
  ).toBeVisible();
  await expect(draft).toHaveValue(message);
  failRead = false;
  await refresh.click();
  await expect(draft).toHaveValue(message);
  const send = page.getByRole('button', { name: 'Send support request', exact: true });
  await send.click();
  await expect(
    page.getByText('Connection interrupted. Refresh before trying again.', { exact: true }),
  ).toBeVisible();
  await expect(draft).toHaveValue(message);
  await expect(page.getByText(/Request saved\. Reference:/)).toHaveCount(0);
  await send.click();
  await expect(page.getByText(/Request saved\. Reference:/)).toBeVisible();
  await expect(draft).toHaveValue('');
  expect(submissionKeys).toHaveLength(2);
  expect(submissionKeys[0]).toBeTruthy();
  expect(submissionKeys[1]).toBe(submissionKeys[0]);
  const response = await request.get('http://localhost:4085/v1/support-requests', {
    headers: { Authorization: 'Bearer synthetic-driver' },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.requests.filter((entry: { message: string }) => entry.message === message)).toHaveLength(1);
});
