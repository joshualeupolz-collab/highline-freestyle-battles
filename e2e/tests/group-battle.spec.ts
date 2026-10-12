import { expect, test } from '@playwright/test';
import { createAthlete, phoneOf } from '../helpers';

test('on-site group battle: placements entered, everyone confirms, ratings change', async ({
  browser,
}) => {
  const anna = await createAthlete('anna');
  const ben = await createAthlete('ben');
  const carla = await createAthlete('carla');
  const annaPhone = await phoneOf(browser, anna);

  await annaPhone.goto('/onsite');
  await annaPhone.getByRole('button', { name: 'Group (3 or more)' }).click();
  await annaPhone.getByRole('combobox', { name: 'Format' }).selectOption({ index: 3 });
  for (const person of [ben, carla]) {
    await annaPhone.getByPlaceholder('Search username…').fill(person.username);
    await annaPhone.getByRole('button', { name: `@${person.username}` }).click();
  }
  // Ben won, Anna second, Carla third.
  await annaPhone.getByLabel(`Place of ${ben.displayName}`).selectOption('1');
  await annaPhone.getByLabel(`Place of ${anna.displayName}`).selectOption('2');
  await annaPhone.getByLabel(`Place of ${carla.displayName}`).selectOption('3');
  await annaPhone.getByRole('button', { name: 'Send to the others for confirmation' }).click();
  await expect(annaPhone).toHaveURL(/\/battles\//);
  const battlePath = new URL(annaPhone.url()).pathname;
  await expect(annaPhone.getByText('Result of the group battle')).toBeVisible();

  for (const person of [ben, carla]) {
    const phone = await phoneOf(browser, person);
    await phone.goto(battlePath);
    await phone.getByRole('button', { name: 'Confirm', exact: true }).click();
    if (person === ben) await expect(phone.getByText('confirmed').first()).toBeVisible();
  }

  await annaPhone.reload();
  const result = annaPhone
    .locator('.card', { hasText: 'Result' })
    .filter({ has: annaPhone.locator('ol') });
  await expect(result.getByText(/1st/)).toBeVisible();
  await expect(result.locator('li').first()).toContainText(ben.displayName);
  await expect(result.locator('li').first()).toContainText(/\+\d+/);
  await expect(result.locator('li').last()).toContainText(carla.displayName);
});
