import { expect, test } from '@playwright/test';
import { createAthlete, PASSWORD, phoneOf } from '../helpers';

test('sign-up in the app, approval by an athlete, then the tabs appear', async ({ browser }) => {
  const sponsor = await createAthlete('sponsor');
  const username = `new_${Date.now().toString(36)}`;

  const context = await browser.newContext();
  const phone = await context.newPage();
  await phone.goto('/register');
  await phone.getByLabel('Username', { exact: true }).fill(username);
  await phone.locator('input[type=password]').fill(PASSWORD);
  await phone.getByLabel('Doing freestyle since').fill('3 years');
  // Every required checkbox (age, and the terms where the app asks for them).
  for (const box of await phone.locator('input[type=checkbox][required]').all()) await box.check();
  await phone.getByRole('button', { name: 'Create account' }).click();
  await expect(phone.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
  await expect(phone.getByRole('navigation')).toHaveCount(0);

  // An approved athlete sees the badge and approves the newcomer.
  const sponsorPhone = await phoneOf(browser, sponsor);
  await sponsorPhone.goto('/approvals');
  const card = sponsorPhone.locator('.card', { hasText: `@${username}` });
  await expect(card.getByText('3 years')).toBeVisible();
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(sponsorPhone.locator('.card', { hasText: `@${username}` })).toHaveCount(0);

  await phone.reload();
  await expect(phone.getByRole('link', { name: 'Rankings' })).toBeVisible();
});
