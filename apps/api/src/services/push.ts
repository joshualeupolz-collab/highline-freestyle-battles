/**
 * Web Push without content (RFC 8030 + VAPID, RFC 8292). The push only wakes the app's service
 * worker, which then fetches its notifications from the API. So no payload encryption is
 * needed (little CPU in the Worker) and no text passes through Google, Apple or Mozilla.
 */

export interface VapidKeys {
  /** Public key, base64url, 65 bytes uncompressed (`npx web-push generate-vapid-keys`). */
  publicKey: string;
  /** Private key, base64url, 32 bytes. */
  privateKey: string;
  /** Contact for the push services: `mailto:…` or an https URL. */
  subject: string;
}

function base64url(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array {
  const s = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const signingKeys = new Map<string, Promise<CryptoKey>>();

/** The private key as a WebCrypto signing key (cached per isolate). */
function signingKey(keys: VapidKeys): Promise<CryptoKey> {
  let key = signingKeys.get(keys.privateKey);
  if (!key) {
    const pub = fromBase64url(keys.publicKey);
    if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be 65 bytes');
    key = crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        d: keys.privateKey,
        x: base64url(pub.slice(1, 33)),
        y: base64url(pub.slice(33, 65)),
        ext: false,
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    signingKeys.set(keys.privateKey, key);
  }
  return key;
}

/** The VAPID token for one push service (its origin), valid 12 hours. */
export async function vapidToken(endpoint: string, keys: VapidKeys, now = Date.now()) {
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: keys.subject,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await signingKey(keys),
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(signature)}`;
}

/**
 * Sends one empty push. Returns `gone` when the push service says the subscription no longer
 * exists (404/410) – it should be deleted then.
 */
export async function sendPush(
  endpoint: string,
  keys: VapidKeys,
): Promise<'sent' | 'gone' | 'failed'> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${await vapidToken(endpoint, keys)}, k=${keys.publicKey}`,
        TTL: String(24 * 3600),
        Urgency: 'normal',
        'Content-Length': '0',
      },
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
