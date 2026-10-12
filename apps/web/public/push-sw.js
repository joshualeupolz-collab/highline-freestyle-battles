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
          data: { url: n.url },
        });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => 'focus' in w);
      if (open) {
        await open.navigate(url);
        return open.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
