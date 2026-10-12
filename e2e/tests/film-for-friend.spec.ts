import { expect, test } from '@playwright/test';
import { BASE_URL, createAthlete, phoneOf, recordAttempt } from '../helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

test('a friend films with the athlete code: online into the battle, offline via the inbox', async ({
  browser,
}) => {
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

  // Anna shares her code; the friend has no account.
  await annaPhone.goto('/profile');
  const code = (await annaPhone.locator('.athlete-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^\w{4}-\w{4}$/);
  const friend = await (await browser.newContext()).newPage();
  friend.on('dialog', (d) => void d.accept());

  // Online: the friend picks the battle and records.
  await friend.goto(`/film?code=${code}`);
  await friend.getByLabel('Your name').fill('Max');
  await friend.getByRole('button', { name: 'Continue' }).click();
  await expect(friend.getByText(`Running battles of ${anna.displayName}`)).toBeVisible();
  await expect(friend.getByText(`against ${ben.displayName}`)).toBeVisible();
  await recordAttempt(friend);
  await expect(friend.getByRole('heading', { name: 'Recordings on this phone' })).toHaveCount(0, {
    timeout: 30_000,
  });

  // Anna sees the attempt as hers, filmed by Max, and can choose it.
  await annaPhone.goto(`/battles/${battleId}`);
  await expect(annaPhone.getByText('filmed by Max')).toBeVisible();
  await expect(annaPhone.getByText('Uploaded', { exact: true })).toBeVisible();

  // Offline at the line: the friend describes the battle and records.
  await friend.context().setOffline(true);
  await friend.getByRole('button', { name: 'Continue' }).click();
  await friend.getByLabel('Which battle?').fill(`Best trick against ${ben.displayName}`);
  await recordAttempt(friend);
  await expect(friend.getByText('Waiting for a connection to upload')).toBeVisible();
  await friend.context().setOffline(false);
  await expect(friend.getByRole('heading', { name: 'Recordings on this phone' })).toHaveCount(0, {
    timeout: 30_000,
  });

  // The video waits in Anna's inbox; she assigns it.
  await annaPhone.goto('/');
  await expect(annaPhone.getByRole('heading', { name: 'Videos from friends' })).toBeVisible();
  await annaPhone
    .getByRole('button', { name: new RegExp(`Best Trick · against ${ben.displayName}`) })
    .click();
  await expect(annaPhone.getByRole('heading', { name: 'Videos from friends' })).toHaveCount(0);

  // Ben confirms that it belongs to the battle.
  await benPhone.goto(`/battles/${battleId}`);
  await expect(benPhone.getByText(`Best trick against ${ben.displayName}`)).toBeVisible();
  await benPhone.getByRole('button', { name: 'Yes, belongs here' }).click();
  await expect(benPhone.getByRole('button', { name: 'Yes, belongs here' })).toHaveCount(0);

  // Now Anna can choose it.
  await annaPhone.goto(`/battles/${battleId}`);
  await expect(annaPhone.getByText('waits for the opponent’s confirmation')).toHaveCount(0);
  await expect(annaPhone.getByRole('button', { name: 'This one counts' })).toHaveCount(2);
});
