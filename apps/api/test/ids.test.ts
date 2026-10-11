import { describe, expect, it } from 'vitest';
import { newId } from '../src/lib/ids';

describe('newId', () => {
  it('creates RFC 9562 version 7 UUIDs', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('sorts by creation time', () => {
    const ids = [3, 1, 2].map((t) => newId(Date.UTC(2026, 9, 11) + t));
    expect([...ids].sort()).toEqual([ids[1], ids[2], ids[0]]);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const t = Date.UTC(2026, 9, 11);
    expect(Number.parseInt(newId(t).replace(/-/g, '').slice(0, 12), 16)).toBe(t);
  });
});
