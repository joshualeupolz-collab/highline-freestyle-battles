/**
 * The number on the app icon (Badging API): how many things wait for me. Phones show it only
 * where the system allows it – the installed app on iPhones (with notifications allowed) and
 * on computers. Android shows a dot or number from the app's notifications instead.
 * The service worker raises the number when a push arrives (public/push-sw.js), so it keeps
 * the last count in Cache Storage.
 */
const CACHE = 'hfb-badge';
const KEY = '/badge-count';

export async function setBadge(count: number): Promise<void> {
  try {
    if (typeof navigator.setAppBadge === 'function') {
      if (count > 0) await navigator.setAppBadge(count);
      else await navigator.clearAppBadge();
    }
  } catch {
    // Not allowed here (e.g. iPhone without notification permission).
  }
  try {
    const cache = await caches.open(CACHE);
    await cache.put(KEY, new Response(String(count)));
  } catch {
    // No Cache Storage (private mode): the service worker starts from 0.
  }
}
