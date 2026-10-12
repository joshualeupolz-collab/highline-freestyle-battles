/**
 * Push notifications on this device (Web Push): ask for permission, register with the push
 * service and tell the API. The service worker shows them (public/push-sw.js).
 */
import { api } from './api';

export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iPhones only allow push in the installed app (home screen). */
export function needsInstallForPush(): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios && !matchMedia('(display-mode: standalone)').matches;
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(base64url.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Turns push on. Returns why not, or null when it worked. */
export async function enablePush(): Promise<'unsupported' | 'denied' | 'not_configured' | null> {
  if (!isPushSupported()) return 'unsupported';
  const { publicKey } = await api.pushKey();
  if (!publicKey) return 'not_configured';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await api.pushSubscribe(sub.endpoint);
  return null;
}

/** Turns push off on this device (also at logout, so the next person gets no pushes). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}
