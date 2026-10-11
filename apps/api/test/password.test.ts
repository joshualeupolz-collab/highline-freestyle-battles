import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  needsRehash,
  PASSWORD_ITERATIONS,
  verifyPassword,
} from '../src/auth/password';

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse battery', 'pepper');
    expect(await verifyPassword('correct horse battery', hash, 'pepper')).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash, 'pepper')).toBe(false);
  });

  it('needs the pepper: a stolen database alone is not enough', async () => {
    const hash = await hashPassword('correct horse battery', 'pepper');
    expect(await verifyPassword('correct horse battery', hash, 'other-pepper')).toBe(false);
  });

  it('uses a random salt, so equal passwords have different hashes', async () => {
    expect(await hashPassword('same', 'p')).not.toBe(await hashPassword('same', 'p'));
  });

  it('refuses to work without a pepper', async () => {
    await expect(hashPassword('x', '')).rejects.toThrow(/PASSWORD_PEPPER/);
  });

  it('marks hashes with fewer iterations for an upgrade', async () => {
    expect(needsRehash(await hashPassword('x', 'p', 1000))).toBe(true);
    expect(needsRehash(await hashPassword('x', 'p', PASSWORD_ITERATIONS))).toBe(false);
    expect(await verifyPassword('x', 'garbage', 'p')).toBe(false);
  });
});
