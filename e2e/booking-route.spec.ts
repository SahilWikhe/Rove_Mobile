import { expect, test } from './fixtures';

test('compact route panel supports destination-first entry and editing without losing the other endpoint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Where are you going?', exact: true }).click();
  await page.getByRole('button', { name: 'Enter destination address', exact: true }).click();
  await page.getByRole('textbox', { name: 'Destination address', exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Search places', exact: true }).click();
  await page.getByRole('button', { name: 'Work · synthetic destination', exact: true }).click();
  await page.getByRole('textbox', { name: 'Pickup address', exact: true }).fill('Home');
  await page.getByRole('button', { name: 'Search places', exact: true }).click();
  await page.getByRole('button', { name: 'Home · synthetic pickup', exact: true }).click();
  await page.getByRole('button', { name: 'Change pickup', exact: true }).click();
  await expect(page.getByText('Work · synthetic destination', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Pickup address', exact: true }).fill('Home');
  // The native keyboard Search action follows the same explicit search path.
  await page.getByRole('textbox', { name: 'Pickup address', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Home · synthetic pickup', exact: true }).click();
  await page.getByRole('button', { name: 'See your fare', exact: true }).click();
  await expect(page.getByText('Pickup: Home · synthetic pickup', { exact: true })).toBeVisible();
  await expect(page.getByText('Destination: Work · synthetic destination', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request ride', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit route or service', exact: true }).click();
  await page.getByRole('button', { name: 'Close booking', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Where are you going?', exact: true })).toBeVisible();
});
