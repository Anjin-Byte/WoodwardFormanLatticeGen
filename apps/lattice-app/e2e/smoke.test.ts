import { test, expect } from '@playwright/test';

test('app loads and renders viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="viewport"]')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
});

test('sidebar is visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible();
  await expect(page.getByText('Lattice')).toBeVisible();
});
