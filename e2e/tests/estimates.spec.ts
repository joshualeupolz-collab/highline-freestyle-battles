import { expect, test } from '@playwright/test';
import { createAthlete, phoneOf } from '../helpers';

test('estimate a newcomer on their profile, then withdraw it', async ({ browser }) => {
  const anna = await createAthlete('anna');
  const newcomer = await createAthlete('newbie');
  const phone = await phoneOf(browser, anna);

  await phone.goto(`/users/${newcomer.id}`);
  await phone.getByText(`Estimate ${newcomer.displayName}`).click();
  const card = phone.locator('details', { hasText: `Estimate ${newcomer.displayName}` });
  await card.getByRole('combobox', { name: 'Format' }).selectOption({ label: 'Best Trick' });
  await card.getByRole('spinbutton').fill('1700');
  await phone.getByRole('button', { name: 'Save estimate' }).click();
  await expect(phone.getByText('Saved.')).toBeVisible();
  await expect(phone.getByText('1 estimates so far')).toBeVisible();
  await expect(phone.getByText('Best Trick: 1700')).toBeVisible();

  await phone.getByRole('button', { name: 'Withdraw' }).click();
  await expect(phone.getByText('0 estimates so far')).toBeVisible();
});
