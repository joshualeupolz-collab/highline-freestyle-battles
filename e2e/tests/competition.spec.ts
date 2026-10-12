import { expect, test } from '@playwright/test';
import { createAthlete, grantRole, phoneOf } from '../helpers';

test('competition: organizer enters a battle, a judge confirms, it counts', async ({ browser }) => {
  const org = await createAthlete('org');
  const judge = await createAthlete('judge');
  const anna = await createAthlete('anna');
  const ben = await createAthlete('ben');
  await grantRole(org, 'organizer');
  await grantRole(judge, 'judge');

  const orgPhone = await phoneOf(browser, org);
  await orgPhone.goto('/competitions');
  await orgPhone.getByText('New competition').click();
  await orgPhone.getByLabel('Name', { exact: true }).fill('Test Cup');
  await orgPhone.getByRole('combobox', { name: /Weight of all battles/ }).selectOption('2');
  await orgPhone.getByRole('button', { name: 'Create competition' }).click();
  await expect(orgPhone.getByRole('heading', { name: 'Test Cup' })).toBeVisible();

  await orgPhone.getByText('Add a battle').click();
  const card = orgPhone.locator('details', { hasText: 'Add a battle' });
  await card.getByRole('combobox', { name: 'Format' }).selectOption({ index: 3 });
  const pickers = card.getByPlaceholder('Search username…');
  await pickers.first().fill(anna.username);
  await card.getByRole('button', { name: `@${anna.username}` }).click();
  await card.getByPlaceholder('Search username…').fill(ben.username);
  await card.getByRole('button', { name: `@${ben.username}` }).click();
  await card.getByRole('button', { name: `${anna.displayName} clearly better` }).click();
  await expect(orgPhone.locator('.card', { hasText: ben.displayName }).first()).toBeVisible();
  await orgPhone.getByRole('button', { name: 'Done – ask for confirmation' }).click();
  await expect(orgPhone.getByText('waiting for confirmation')).toBeVisible();

  const judgePhone = await phoneOf(browser, judge);
  await judgePhone.goto(new URL(orgPhone.url()).pathname);
  await judgePhone.getByRole('button', { name: 'Confirm the results' }).click();
  await expect(judgePhone.getByText(`Confirmed by ${judge.displayName}`)).toBeVisible();

  // Anna sees the decided battle with her rating change.
  const annaPhone = await phoneOf(browser, anna);
  await annaPhone.goto('/');
  await annaPhone.getByText(ben.displayName).first().click();
  await expect(annaPhone.getByText(`${anna.displayName} won`)).toBeVisible();
  await expect(annaPhone.getByText('Result of an official competition →')).toBeVisible();
});
