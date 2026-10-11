/**
 * UUIDv7 (RFC 9562): 48-bit Unix time in milliseconds followed by random bits.
 * Ids sort by creation time and can also be created offline on the phone.
 */

// Web Crypto exists in browsers, Workers and Node; this package is built without DOM types.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

export function newId(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let time = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
