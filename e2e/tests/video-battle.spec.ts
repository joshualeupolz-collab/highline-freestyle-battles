import { expect, type Page, test } from '@playwright/test';
import { createAthlete, phoneOf } from '../helpers';

/** Records one attempt of a few seconds with the (fake) camera and queues it for upload. */
async function recordAttempt(phone: Page) {
  await phone.getByRole('button', { name: 'Record attempt' }).first().click();
  const record = phone.locator('.camera-full').getByRole('button', { name: 'Record attempt' });
  await expect(record).toBeEnabled();
  await record.click();
  await expect(phone.locator('.camera-full').getByText(/● [2-9]\.\d s/)).toBeVisible();
  await phone.getByRole('button', { name: 'Stop' }).click();
  // Cut and upload: the whole recording, default visibility.
  await expect(phone.getByRole('heading', { name: 'Cut and upload' })).toBeVisible();
  await phone.getByRole('button', { name: 'Upload', exact: true }).click();
}

test('online battle: record, upload (one phone offline), choose, unlock, vote', async ({
  browser,
}) => {
  const anna = await createAthlete('anna');
  const ben = await createAthlete('ben');
  const annaPhone = await phoneOf(browser, anna);
  const benPhone = await phoneOf(browser, ben);

  // Anna posts an open request with the default (fixed) settings.
  await annaPhone.goto('/new');
  await annaPhone.getByRole('button', { name: /^Best Trick/ }).click();
  await annaPhone.getByRole('button', { name: 'Post open request' }).click();
  await expect(annaPhone).toHaveURL(/\/battles\//);
  const battlePath = new URL(annaPhone.url()).pathname;

  // Ben accepts it from the request list; fixed settings start the battle right away.
  await benPhone.goto('/open');
  await benPhone
    .locator('.card', { hasText: anna.displayName })
    .getByRole('button', { name: 'Accept', exact: true })
    .click();
  await expect(benPhone).toHaveURL(battlePath);
  await expect(benPhone.getByRole('heading', { name: 'Your attempts' })).toBeVisible();

  // Anna records online.
  await annaPhone.reload();
  await recordAttempt(annaPhone);
  await expect(annaPhone.getByText('Uploaded', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Ben records without a connection: the video waits on the phone …
  await benPhone.context().setOffline(true);
  await recordAttempt(benPhone);
  await expect(benPhone.getByText('Waiting for a connection to upload')).toBeVisible();
  // … and is uploaded by itself once the phone is back online.
  await benPhone.context().setOffline(false);
  await expect(benPhone.getByText('Uploaded', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Neither sees the other's video before both have chosen.
  await annaPhone.reload();
  await expect(annaPhone.getByRole('heading', { name: 'Videos', exact: true })).toHaveCount(0);

  // Both choose their attempt; the second choice unlocks the videos.
  await annaPhone.getByRole('button', { name: 'This one counts' }).click();
  await expect(annaPhone.getByText('✓ This attempt counts')).toBeVisible();
  await benPhone.reload();
  await benPhone.getByRole('button', { name: 'This one counts' }).click();
  await expect(benPhone.getByRole('heading', { name: 'Videos', exact: true })).toBeVisible();

  // Ben can play Anna's video.
  const annasVideo = benPhone
    .locator('section', { has: benPhone.getByRole('heading', { name: 'Videos', exact: true }) })
    .locator('div', { hasText: anna.displayName })
    .locator('video')
    .first();
  await expect(annasVideo).toBeVisible();
  await expect
    .poll(() => annasVideo.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Review level 1: both see Anna in front, with a different margin.
  await benPhone.getByRole('button', { name: `${anna.displayName} somewhat better` }).click();
  await expect(
    benPhone.getByText(`Waiting for the vote of ${anna.displayName}`).first(),
  ).toBeVisible();
  await annaPhone.reload();
  await annaPhone.getByRole('button', { name: `${anna.displayName} clearly better` }).click();

  // Agreement decides: s = mean of 1 and 0.75.
  await expect(annaPhone.getByText(`${anna.displayName} won`)).toBeVisible();
  await expect(annaPhone.getByText('(0.875 : 0.125)')).toBeVisible();
  await benPhone.reload();
  await expect(benPhone.getByText(`${anna.displayName} won`)).toBeVisible();
});
