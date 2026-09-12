import { expect, test } from './fixtures';

test('rider navigation labels fit a compact screen and the last home action clears the floating bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('http://localhost:8091');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Where are you going?', exact: true })).toBeVisible();
  for (const label of ['Ride', 'My rides', 'Messages', 'Account']) {
    const button = page.getByRole('button', {
      name: label === 'Messages' ? /^Messages(?:, \d+ unread)?$/ : label,
      exact: true,
    });
    const text = button.getByText(label, { exact: true });
    const geometry = await text.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, lineHeight: parseFloat(getComputedStyle(element).lineHeight) };
    });
    expect(geometry.height, `${label} should remain on one line at default text size`).toBeLessThanOrEqual(
      geometry.lineHeight + 1,
    );
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }
  const choose = page.getByRole('button', { name: 'Choose a destination', exact: true });
  await choose.evaluate((element) => {
    let parent = element.parentElement;
    while (parent && !['auto', 'scroll'].includes(getComputedStyle(parent).overflowY))
      parent = parent.parentElement;
    if (!parent) throw new Error('Home scroll container missing');
    parent.scrollTop = parent.scrollHeight;
  });
  await page.screenshot({ path: '/tmp/rove-rider-small-screen.png' });
  const card = await choose.boundingBox();
  const nav = await page.getByRole('button', { name: 'Ride', exact: true }).boundingBox();
  expect(card!.y + card!.height).toBeLessThan(nav!.y);
  await choose.click();
  await expect(page.getByRole('button', { name: 'Close booking', exact: true })).toBeVisible();
});
