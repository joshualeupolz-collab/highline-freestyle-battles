import { expect, test } from '@playwright/test';
import { adminPhone as adminLogin, createAthlete, phoneOf } from '../helpers';

test('report a profile; an admin sees it and closes it with a note', async ({ browser }) => {
  const anna = await createAthlete('anna');
  const fake = await createAthlete('fake');
  const annaPhone = await phoneOf(browser, anna);

  await annaPhone.goto(`/users/${fake.id}`);
  await annaPhone.getByRole('button', { name: 'Report', exact: true }).click();
  await annaPhone.getByLabel('What is wrong?').selectOption('fake_account');
  await annaPhone.getByLabel('Describe what happened').fill('Same person as another account.');
  await annaPhone.getByRole('button', { name: 'Send report' }).click();
  await expect(annaPhone.getByText('Thank you. The federation will look at it.')).toBeVisible();

  const adminPhone = await adminLogin(browser);
  await adminPhone.goto('/profile');
  await adminPhone.getByRole('link', { name: /^Reports/ }).click();
  const card = adminPhone.locator('.card', { hasText: 'Same person as another account.' });
  await expect(card.getByText(`reported by ${anna.displayName}`)).toBeVisible();
  await card.getByLabel('What was done?').fill('Checked with the community: real person.');
  await card.getByRole('button', { name: 'Close report' }).click();
  await expect(card).toHaveCount(0);

  await annaPhone.goto('/reports');
  await expect(
    annaPhone.locator('.card', { hasText: 'Same person' }).getByText('handled'),
  ).toBeVisible();
});
