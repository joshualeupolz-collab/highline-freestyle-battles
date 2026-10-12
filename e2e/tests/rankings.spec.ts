import { expect, test } from '@playwright/test';
import { createAthlete, phoneOf } from '../helpers';

test('combined ranking: official by default, formats can be chosen freely', async ({ browser }) => {
  const anna = await createAthlete('anna');
  const phone = await phoneOf(browser, anna);
  await phone.goto('/rankings');
  await phone.getByRole('button', { name: 'Combined' }).click();
  await expect(phone.getByText(/^Official: .*the worst 1 dropped\.$/)).toBeVisible();

  await phone.getByText('Choose formats yourself').click();
  await phone.getByLabel('10-Bounce Combo').uncheck();
  await expect(
    phone.getByText(/^Your choice: (?!.*10-Bounce).*the worst 1 dropped\.$/),
  ).toBeVisible();
  await phone.getByRole('button', { name: 'Back to the official ranking' }).click();
  await expect(phone.getByText(/^Official:/)).toBeVisible();
});
