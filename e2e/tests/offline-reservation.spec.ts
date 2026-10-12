import { expect, test } from '@playwright/test';
import { createAthlete, phoneOf } from '../helpers';

/** Records one attempt on the battle page and hands it to the upload queue. */
async function record(phone: import('@playwright/test').Page) {
  await phone.getByRole('button', { name: 'Record attempt' }).first().click();
  const button = phone.locator('.camera-full').getByRole('button', { name: 'Record attempt' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(phone.locator('.camera-full').getByText(/● [2-9]\.\d s/)).toBeVisible();
  await phone.getByRole('button', { name: 'Stop' }).click();
  await phone.getByRole('button', { name: 'Upload', exact: true }).click();
}

test('offline recording: reserve, take over on a second device, report back', async ({
  browser,
}) => {
  const anna = await createAthlete('anna');
  const ben = await createAthlete('ben');
  // Two devices of Anna (each browser context has its own device code) and Ben's phone.
  const phone = await phoneOf(browser, anna);
  const tablet = await phoneOf(browser, anna);
  const benPhone = await phoneOf(browser, ben);

  // Ben posts a request with the default settings (best of 3); Anna accepts.
  await benPhone.goto('/new');
  await benPhone.getByRole('button', { name: /^Best Trick/ }).click();
  await benPhone.getByRole('button', { name: 'Post open request' }).click();
  await expect(benPhone).toHaveURL(/\/battles\//);
  const battlePath = new URL(benPhone.url()).pathname;
  await phone.goto('/open');
  await phone
    .locator('.card', { hasText: ben.displayName })
    .getByRole('button', { name: 'Accept', exact: true })
    .click();
  await expect(phone).toHaveURL(battlePath);

  // Offline without a reservation: recording is refused.
  await phone.context().setOffline(true);
  await phone.getByRole('button', { name: 'Record attempt' }).first().click();
  await expect(phone.getByText(/You are offline\. Recording offline needs/)).toBeVisible();
  await phone.context().setOffline(false);

  // The phone reserves all three attempts and records one offline.
  await phone.getByRole('button', { name: 'Prepare for offline recording' }).click();
  await phone.getByRole('button', { name: 'Reserve', exact: true }).click();
  await expect(phone.getByText(/3 attempt\(s\) reserved · this device/)).toBeVisible();
  await phone.context().setOffline(true);
  await record(phone);
  await expect(phone.getByText('Waiting for a connection to upload')).toBeVisible();

  // Its battery dies. The tablet sees the reservation and takes over.
  await tablet.goto(battlePath);
  await expect(tablet.getByText(/3 attempt\(s\) reserved · another device/)).toBeVisible();
  await tablet.getByRole('button', { name: 'Prepare for offline recording' }).click();
  await expect(tablet.getByText(/attempts are reserved on another device/)).toBeVisible();
  await tablet.getByRole('button', { name: 'Reserve', exact: true }).click();
  await expect(
    tablet.getByText(/attempt\(s\) taken over \(provisional\) · this device/),
  ).toBeVisible();
  await record(tablet);
  await expect(tablet.getByText('Uploaded', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(tablet.getByText('provisional', { exact: false }).first()).toBeVisible();

  // Ben follows it in the chat and next to Anna's progress.
  await benPhone.reload();
  await expect(benPhone.getByText(/reserved 3 attempt\(s\) for offline recording/)).toBeVisible();

  // The phone comes back: uploads, reports, and hands back the two unused attempts, so the
  // tablet's attempt becomes valid.
  await phone.context().setOffline(false);
  await expect(phone.getByText('Uploaded', { exact: true })).toBeVisible({ timeout: 30_000 });
  await phone.reload();
  await phone.getByRole('button', { name: 'Hand back unused' }).click();
  await expect(phone.getByText(/done, 1 recorded/)).toBeVisible();
  await tablet.reload();
  await expect(tablet.getByRole('button', { name: 'This one counts' })).toHaveCount(2);
});
