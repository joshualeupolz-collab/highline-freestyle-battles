// Push notifications, loaded into the service worker (vite.config.ts → workbox.importScripts).
// The push itself is empty (apps/api/src/services/push.ts): fetch the texts from the API and
// show them. Every push must show a notification (iOS stops pushes otherwise), so there is a
// general one if the texts cannot be fetched.
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let list = [];
      try {
        const res = await fetch('/api/notifications/pending', { credentials: 'include' });
        if (res.ok) list = (await res.json()).notifications ?? [];
      } catch {
        // Offline or logged out: the general notification below.
      }
      if (list.length === 0)
        list = [{ title: 'Highline Battles', body: 'Something new is waiting for you.', url: '/' }];
      for (const n of list.slice(0, 5)) {
        await self.registration.showNotification(n.title, {
          body: n.body,
          icon: '/icon-192.png',
          tag: n.url,
          // A second message in the same battle replaces the first one but still alerts.
          renotify: true,
          data: { url: n.url },
        });
      }
      await raiseBadge(list.length);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => 'focus' in w);
      if (open) {
        // Focus first: Android allows it only right after the tap. `navigate` fails on pages the
        // service worker does not control, so it must not stop the app from coming to the front;
        // then the app itself switches to the page (main.tsx listens for this message).
        let focused = null;
        try {
          focused = (await open.focus()) ?? open;
        } catch {
          // Could not bring it to the front: open a new window below.
        }
        if (focused) {
          try {
            await focused.navigate(url);
          } catch {
            focused.postMessage({ type: 'open', url });
          }
          return;
        }
      }
      // App closed (or the window could not be used): open it at the page of the notification.
      await self.clients.openWindow(url);
    })(),
  );
});

// The number on the app icon (src/badge.ts): the app stores the exact count when it runs; a push
// adds its new notifications until the app is opened again.
async function raiseBadge(added) {
  try {
    const cache = await caches.open('hfb-badge');
    const stored = await cache.match('/badge-count');
    const count = (stored ? Number(await stored.text()) || 0 : 0) + added;
    await cache.put('/badge-count', new Response(String(count)));
    if (self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
  } catch {
    // No badge on this platform.
  }
}
