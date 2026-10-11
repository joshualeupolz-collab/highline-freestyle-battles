/**
 * The database itself protects the data: CHECK constraints, unique indexes, foreign keys.
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const NOW = Date.UTC(2026, 9, 11);

async function insertUser(id: string, username: string, status = 'active') {
  await env.DB.prepare(
    'INSERT INTO users (id, username, display_name, status, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, username, username, status, NOW)
    .run();
}

async function grantRole(
  id: string,
  userId: string,
  role: string,
  revokedAt: number | null = null,
) {
  await env.DB.prepare(
    'INSERT INTO user_roles (id, user_id, role, granted_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, userId, role, NOW, revokedAt)
    .run();
}

describe('database constraints', () => {
  it('rejects unknown enum values', async () => {
    await expect(insertUser('u1', 'anna', 'superuser')).rejects.toThrow(/CHECK/);
    await insertUser('u1', 'anna');
    await expect(grantRole('r1', 'u1', 'king')).rejects.toThrow(/CHECK/);
  });

  it('treats usernames case-insensitively', async () => {
    await insertUser('u1', 'Anna');
    await expect(insertUser('u2', 'anna')).rejects.toThrow(/UNIQUE/);
  });

  it('allows one active grant per role, revoked grants stay as history', async () => {
    await insertUser('u1', 'anna');
    await grantRole('r1', 'u1', 'judge', NOW);
    await grantRole('r2', 'u1', 'judge');
    await expect(grantRole('r3', 'u1', 'judge')).rejects.toThrow(/UNIQUE/);
  });

  it('enforces foreign keys', async () => {
    await expect(grantRole('r1', 'missing-user', 'athlete')).rejects.toThrow(/FOREIGN KEY/);
  });

  it('accepts only valid JSON and sensible battle values', async () => {
    await insertUser('u1', 'anna');
    const formatId = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';
    const insertBattle = (id: string, level: number) =>
      env.DB.prepare(
        `INSERT INTO battles (id, format_id, format_version, ruleset_version, level, created_by, created_at)
         VALUES (?, ?, 1, 1, ?, 'u1', ?)`,
      )
        .bind(id, formatId, level, NOW)
        .run();
    await insertBattle('b1', 3);
    await expect(insertBattle('b2', 6)).rejects.toThrow(/CHECK/);
    await expect(
      env.DB.prepare(
        `INSERT INTO battle_proposals (id, battle_id, kind, payload_json, proposed_by, created_at)
         VALUES ('p1', 'b1', 'settings', '{not json', 'u1', ?)`,
      )
        .bind(NOW)
        .run(),
    ).rejects.toThrow(/CHECK/);
  });
});
