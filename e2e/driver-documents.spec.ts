import { test, expect } from './fixtures';
test('driver reaches document intake and sees truthful unavailable-storage recovery', async ({
  page,
}, testInfo) => {
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Driver setup', exact: true }).click();
  await page.getByRole('button', { name: 'View driving documents', exact: true }).click();
  await expect(page.getByText('Ready for review.', { exact: true })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose driver’s license', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'synthetic.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 synthetic fixture'),
  });
  await expect(
    page.getByText('Document uploads are not available yet. Try again later.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose driver’s license', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Refresh documents', exact: true }).click();
  await expect(page.getByText('Previous upload is incomplete.', { exact: true })).toBeVisible();
  await expect(page.getByText('Uploaded. Verification is pending.', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('driver-documents.png'), fullPage: true });
});

test('verification retry reuses transferred file and expiry releases the picker', async ({ page }) => {
  let transfers = 0;
  let completions = 0;
  await page.route('**/v1/drivers/me/documents/*/upload', async (route) => {
    const id = route.request().url().split('/').at(-2)!;
    const key = `driver-documents/inbox/${id}/00000000-0000-4000-8000-000000000099`;
    await route.fulfill({
      json: {
        documentId: id,
        key,
        url: 'https://rove-private-fixture.s3.us-east-2.amazonaws.com/',
        fields: { key, Policy: 'synthetic-test-policy' },
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      },
    });
  });
  await page.route('https://rove-private-fixture.s3.us-east-2.amazonaws.com/', async (route) => {
    transfers++;
    await route.fulfill({ status: 201, body: '' });
  });
  await page.route('**/v1/drivers/me/documents/*/complete', async (route) => {
    completions++;
    await route.fulfill({
      status: completions === 1 ? 503 : 409,
      json: {
        error: {
          code: completions === 1 ? 'DOCUMENT_STORAGE_UNAVAILABLE' : 'DOCUMENT_EXPIRED',
          message:
            completions === 1
              ? 'Temporary verification failure.'
              : 'This upload expired. Start a new upload.',
        },
      },
    });
  });
  await page.goto('http://localhost:8092');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Driver setup', exact: true }).click();
  await page.getByRole('button', { name: 'View driving documents', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose driver’s license', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'synthetic.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 synthetic retry fixture'),
  });
  await expect(page.getByText('Temporary verification failure.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose driver’s license', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry upload verification', exact: true }).click();
  await expect(page.getByText('This upload expired. Start a new upload.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose driver’s license', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Retry upload verification', exact: true })).toHaveCount(0);
  expect(transfers).toBe(1);
  expect(completions).toBe(2);
});
