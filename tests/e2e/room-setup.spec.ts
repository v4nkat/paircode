import { test, expect } from '@playwright/test';

test('missing service configuration fails closed with a useful setup page', async ({
  page,
  request,
}) => {
  test.skip(Boolean(process.env.CLERK_SECRET_KEY), 'This check covers the unconfigured preview.');
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'A space for your next practice session.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'View setup guide' })).toBeVisible();
  const response = await request.get('/api/rooms');
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
  await page.goto('/join');
  await expect(
    page.getByRole('heading', { name: 'A space for your next practice session.' }),
  ).toBeVisible();
});
