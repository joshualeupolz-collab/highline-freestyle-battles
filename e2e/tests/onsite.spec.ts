import { expect, test } from '@playwright/test';
import { createAthlete, phoneOf } from '../helpers';

test('on-site result: one side enters it, the other confirms, both ratings change', async ({
  browser,
}) => {
  const anna = await createAthlete('anna');
  const ben = await createAthlete('ben');
  const annaPhone = await phoneOf(browser, anna);
  const benPhone = await phoneOf(browser, ben);

  // Anna enters the result: she was clearly better.
  await annaPhone.goto('/onsite');
  await annaPhone.getByLabel('Format').selectOption({ index: 1 });
  await annaPhone.getByPlaceholder('Search username…').fill(ben.username);
  await annaPhone.getByRole('button', { name: `@${ben.username}` }).click();
  await annaPhone.getByRole('button', { name: `${anna.displayName} clearly better` }).click();
  await annaPhone.getByRole('button', { name: `Send to ${ben.displayName}` }).click();
  await expect(annaPhone).toHaveURL(/\/battles\//);
  const battleUrl = new URL(annaPhone.url()).pathname;

  // Ben sees it in his battle list and confirms it on the battle page.
  await benPhone.goto('/');
  await benPhone.getByText(anna.displayName).first().click();
  await expect(benPhone).toHaveURL(new RegExp(battleUrl));
  await expect(
    benPhone.getByText(`Result: ${anna.displayName} clearly better`, { exact: true }),
  ).toBeVisible();
  await benPhone.getByRole('button', { name: 'Accept', exact: true }).click();

  // Decided, with the rating change of both.
  await expect(benPhone.getByText(`${anna.displayName} won`)).toBeVisible();
  await expect(benPhone.getByText(/1500 → 1[6-9]\d\d \(\+\d+\)/)).toBeVisible();
  await expect(benPhone.getByText(/1500 → 1[0-4]\d\d \(-\d+\)/)).toBeVisible();

  await annaPhone.reload();
  await expect(annaPhone.getByText(`${anna.displayName} won`)).toBeVisible();
});
