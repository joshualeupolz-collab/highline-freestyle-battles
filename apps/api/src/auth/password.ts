/**
 * Password hashing (docs/architecture.md, "Passwords").
 *
 * hash = PBKDF2-SHA256(HMAC-SHA256(pepper, password), random salt, iterations)
 *
 * - The pepper is a secret outside the database: a stolen database alone is useless.
 * - PBKDF2 is slow on purpose and runs natively in Workers (fast enough for the CPU limit).
 * - The stored string records its parameters. When PASSWORD_ITERATIONS is raised, old hashes
 *   still verify and are upgraded at the next successful login (`needsRehash`).
 */
import { fromBase64Url, hmacSha256, randomBytes, timingSafeEqual, toBase64Url } from './crypto';

/**
 * Workers Free allows only ~10 ms CPU per request; 100,000 iterations (the Workers maximum)
 * measured ~17 ms. Re-measure after the first deployment and raise if there is headroom.
 */
export const PASSWORD_ITERATIONS = 50_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SCHEME = 'pbkdf2-sha256';

async function derive(password: string, pepper: string, salt: Uint8Array, iterations: number) {
  if (!pepper) throw new Error('PASSWORD_PEPPER is not configured');
  const peppered = await hmacSha256(pepper, password);
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  pepper: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, pepper, salt, iterations);
  return `${SCHEME}$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
  pepper: string,
): Promise<boolean> {
  const [scheme, iterationsText, saltText, hashText] = stored.split('$');
  const iterations = Number(iterationsText);
  if (scheme !== SCHEME || !Number.isInteger(iterations) || !saltText || !hashText) return false;
  const actual = await derive(password, pepper, fromBase64Url(saltText), iterations);
  return timingSafeEqual(actual, fromBase64Url(hashText));
}

export function needsRehash(stored: string): boolean {
  const [scheme, iterationsText] = stored.split('$');
  return scheme !== SCHEME || Number(iterationsText) < PASSWORD_ITERATIONS;
}

/**
 * Burns the same CPU time as a real check. Used when a username does not exist, so the
 * response time does not reveal which usernames exist.
 */
export async function dummyVerify(pepper: string): Promise<void> {
  await derive('dummy-password', pepper, new Uint8Array(SALT_BYTES), PASSWORD_ITERATIONS);
}
