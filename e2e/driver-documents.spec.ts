import { test, expect } from '@playwright/test';
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
