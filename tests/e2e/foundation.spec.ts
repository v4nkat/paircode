import { test, expect } from '@playwright/test';
test('the foundation page clearly distinguishes planned features from working rooms', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good code starts');
  await expect(
    page.getByText('Foundation release. Interview rooms are coming next.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Built to be understood.' })).toBeInViewport();
  await expect(page.getByRole('link', { name: 'Explore the project' })).toHaveAttribute(
    'href',
    'https://github.com/v4nkat/paircode',
  );
});
