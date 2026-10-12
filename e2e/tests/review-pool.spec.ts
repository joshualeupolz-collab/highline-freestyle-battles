import { expect, test } from '@playwright/test';
import { createAthlete, phoneOf, recordAttempt } from '../helpers';

test('no agreement in the vote: a participant hands the battle to the athlete pool', async ({
  browser,
}) => {
  const anna = await createAthlete('anna');
  const ben = await createAthlete('ben');
  const annaPhone = await phoneOf(browser, anna);
  const benPhone = await phoneOf(browser, ben);

  await annaPhone.goto('/new');
  await annaPhone.getByRole('button', { name: /^Best Trick/ }).click();
  await annaPhone.getByRole('button', { name: 'Post open request' }).click();
  await expect(annaPhone).toHaveURL(/\/battles\//);
  const battlePath = new URL(annaPhone.url()).pathname;
  await benPhone.goto('/open');
  await benPhone
    .locator('.card', { hasText: anna.displayName })
    .getByRole('button', { name: 'Accept', exact: true })
    .click();
  await expect(benPhone).toHaveURL(battlePath);

  for (const phone of [annaPhone, benPhone]) {
    await phone.goto(battlePath);
    await recordAttempt(phone);
    await expect(phone.getByText('Uploaded', { exact: true })).toBeVisible({ timeout: 30_000 });
    await phone.getByRole('button', { name: 'This one counts' }).click();
  }

  // Both see themselves in front.
  await annaPhone.reload();
  await annaPhone.getByRole('button', { name: `${anna.displayName} somewhat better` }).click();
  await benPhone.reload();
  await benPhone.getByRole('button', { name: `${ben.displayName} somewhat better` }).click();

  await benPhone.getByRole('button', { name: 'Let other athletes decide' }).click();
  await expect(benPhone.getByText(/Three other athletes review the battle: 0 of 3/)).toBeVisible();
  await annaPhone.goto('/');
  await expect(annaPhone.getByText('Other athletes review the battle')).toBeVisible();
});
