import { expect, test } from '@playwright/test';
import { BASE_URL, createAthlete, phoneOf, recordAttempt } from '../helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

test('a friend films with the athlete code the athlete chose', async ({ browser }) => {
  const anna = await createAthlete('anna');
  const ben = await createAthlete('ben');
  const annaPhone = await phoneOf(browser, anna);
  const benPhone = await phoneOf(browser, ben);
  const headers = { origin: BASE_URL };

  // A running battle (through the API: the UI for this is covered elsewhere).
  const created = await annaPhone.request.post('/api/battles', {
    data: { formatId: BEST_TRICK, settings: { attemptsPerVideo: 3 } },
    headers,
  });
  const battleId = ((await created.json()) as { battle: { id: string } }).battle.id;
  expect((await benPhone.request.post(`/api/battles/${battleId}/accept`, { headers })).ok()).toBe(
    true,
  );

  // Anna chooses her own code; the friend has no account.
  await annaPhone.goto('/profile');
  await annaPhone.getByRole('button', { name: 'Change code' }).click();
  const code = `Flips ${anna.displayName}`;
  await annaPhone.getByLabel('Your code').fill(code);
  await annaPhone.getByRole('button', { name: 'Save code' }).click();
  await expect(annaPhone.locator('.athlete-code')).toHaveText(code);
  const friend = await (await browser.newContext()).newPage();
  friend.on('dialog', (d) => void d.accept());

  // Online: the friend picks the battle and records.
  await friend.goto(`/film?code=${encodeURIComponent(code.toLowerCase())}`);
  await friend.getByLabel('Your name').fill('Max');
  await friend.getByRole('button', { name: 'Continue' }).click();
  await expect(friend.getByText(`Running battles of ${anna.displayName}`)).toBeVisible();
  await expect(friend.getByText(`against ${ben.displayName}`)).toBeVisible();
  await recordAttempt(friend);
  await expect(friend.getByRole('heading', { name: 'Recordings on this phone' })).toHaveCount(0, {
    timeout: 30_000,
  });

  // Offline: the friend prepares while online (reserves the two attempts left), then films
  // without a connection; the video is uploaded once the phone is back online.
  await friend.getByRole('button', { name: 'Prepare for offline filming' }).click();
  await friend.getByRole('button', { name: 'Reserve', exact: true }).click();
  const prepared = friend.locator('section', {
    has: friend.getByRole('heading', { name: 'Prepared for offline filming' }),
  });
  await expect(prepared.getByText('Attempts left: 2')).toBeVisible();
  await friend.context().setOffline(true);
  await prepared.getByRole('button', { name: 'Record attempt' }).click();
  const button = friend.locator('.camera-full').getByRole('button', { name: 'Record attempt' });
  await button.click();
  await expect(friend.locator('.camera-full').getByText(/● [2-9]\.\d s/)).toBeVisible();
  await friend.getByRole('button', { name: 'Stop' }).click();
  await friend.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(prepared.getByText('Attempts left: 1')).toBeVisible();
  await friend.context().setOffline(false);
  await expect(friend.getByRole('heading', { name: 'Recordings on this phone' })).toHaveCount(0, {
    timeout: 30_000,
  });

  // Anna sees the attempts as hers, filmed by Max, and can choose them.
  await annaPhone.goto(`/battles/${battleId}`);
  await expect(annaPhone.getByText('filmed by Max')).toHaveCount(2);
  await expect(annaPhone.getByText(/2 attempt\(s\) reserved · by Max \(friend\)/)).toBeVisible();
  await expect(annaPhone.getByText('Uploaded', { exact: true })).toHaveCount(2);
  await expect(annaPhone.getByRole('button', { name: 'This one counts' })).toHaveCount(2);

  // Ben sees who filmed it, but not the code.
  await benPhone.goto(`/battles/${battleId}`);
  await expect(benPhone.getByRole('heading', { name: 'Filmed by friends' })).toBeVisible();
  await expect(benPhone.getByText('filmed by Max')).toHaveCount(2);
  await expect(benPhone.getByText(code)).toHaveCount(0);
});
