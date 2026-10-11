/** Small WebCrypto helpers. Everything runs natively in the Workers runtime. */

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Hex SHA-256, used to store tokens and codes without storing the tokens themselves. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

/** Compares two byte arrays in constant time (no early exit that leaks timing). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export function timingSafeEqualText(a: string, b: string): boolean {
  return timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

/** Human-friendly random code like "K7QF-3MXH-PR9C" (no 0/O, 1/I/L). ~60 bits. */
export function randomCode(groups = 3, groupLength = 4): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(groups * groupLength);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  const parts: string[] = [];
  for (let i = 0; i < groups; i++)
    parts.push(chars.slice(i * groupLength, (i + 1) * groupLength).join(''));
  return parts.join('-');
}
