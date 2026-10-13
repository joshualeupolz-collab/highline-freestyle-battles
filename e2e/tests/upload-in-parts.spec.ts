import { expect, test } from '@playwright/test';
import { createAthlete, phoneOf } from '../helpers';

/**
 * A big video goes up in parts; when the connection breaks off, only the missing parts are sent
 * again. The camera of the test browser cannot record 15 MB quickly, so the recording is put
 * into the phone's storage directly (bytes the cutting code cannot read: they are uploaded
 * uncut, which is what the server stores either way).
 */
test('upload in parts: a broken part is sent again, the parts before it are not', async ({
  browser,
}) => {
  const anna = await createAthlete('anna');
  const ben = await createAthlete('ben');
  const phone = await phoneOf(browser, anna);
  const benPhone = await phoneOf(browser, ben);

  await benPhone.goto('/new');
  await benPhone.getByRole('button', { name: /^Best Trick/ }).click();
  await benPhone.getByRole('button', { name: 'Post open request' }).click();
  await expect(benPhone).toHaveURL(/\/battles\//);
  const battlePath = new URL(benPhone.url()).pathname;
  const battleId = battlePath.split('/').at(-1) as string;
  await phone.goto('/open');
  await phone
    .locator('.card', { hasText: ben.displayName })
    .getByRole('button', { name: 'Accept', exact: true })
    .click();
  await expect(phone).toHaveURL(battlePath);

  // Count the parts sent; the third one breaks off until the connection is "back".
  const sent = new Map<string, number>();
  let breakThird = true;
  await phone.route(/\/api\/videos\/[^/]+\/parts\/\d+$/, async (route) => {
    const part = route.request().url().split('/').at(-1) as string;
    sent.set(part, (sent.get(part) ?? 0) + 1);
    if (part === '3' && breakThird) {
      await route.abort('connectionreset');
    } else {
      await route.continue();
    }
  });

  // A 15 MB recording waiting for upload: parts of 6 MiB, 6 MiB and the rest.
  await phone.evaluate(async (battleId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hfb-video', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const id = crypto.randomUUID();
    const size = 15_000_000;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i += 4096) data[i] = i % 251;
    const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
    tx.objectStore('chunks').put({ recordingId: id, index: 0, data: data.buffer });
    tx.objectStore('recordings').put({
      id,
      createdAt: Date.now(),
      status: 'done',
      endReason: 'stopped',
      attempt: 1,
      quality: 'hd',
      mimeType: 'video/mp4',
      chunkCount: 15,
      bytes: size,
      durationMs: 15_000,
      diagnostics: {},
      battle: { battleId, partIndex: 0, round: 1, synced: false },
      upload: { state: 'queued', visibility: 'public', keep: false },
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, battleId);

  // The queue starts with the page: parts 1 and 2 arrive, part 3 breaks off.
  await phone.reload();
  await expect(
    phone.getByText(/Waiting for a connection to upload the rest \(8\d % sent\)/),
  ).toBeVisible({ timeout: 30_000 });
  expect(sent.get('1')).toBe(1);
  expect(sent.get('2')).toBe(1);

  // Next run (the app is opened again): only part 3 is sent.
  breakThird = false;
  await phone.reload();
  await expect(phone.getByText('Uploaded', { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(sent.get('1')).toBe(1);
  expect(sent.get('2')).toBe(1);
});
