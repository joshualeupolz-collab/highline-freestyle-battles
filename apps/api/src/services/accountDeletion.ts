/**
 * Deleting one's own account (concept section 12, decided 2026-10-11):
 *
 * - The user row stays (battles and opponents' ratings remain valid) but loses everything
 *   personal: username → "deleted-…", display name "Deleted user", no e-mail, no password,
 *   no questionnaire. Sessions, login links and reset codes are removed, roles revoked.
 * - Chat messages of the account are deleted.
 * - Running battles count as giving up: active battles and those in review become a win for the
 *   opponent. Open requests, direct challenges to the account and battles still agreeing on
 *   settings or waiting for an on-site confirmation are cancelled.
 * - Videos: kept by default (the person can choose to delete them). Kept videos follow the normal
 *   clean-up; the deletion link lets the person delete them later.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { randomBytes, sha256Hex, toBase64Url } from '../auth/crypto';
import { winnerScores } from '../battles/rules';
import { type Database, runBatch } from '../db/client';
import {
  battleMessages,
  battleParticipants,
  battles,
  notifications,
  oauthAccounts,
  passwordResetCodes,
  pushSubscriptions,
  sessions,
  userRoles,
  users,
  videos,
} from '../db/schema';
import { auditInsert } from '../lib/audit';
import { cancelStatements, decideStatements } from './battles';

/** Ends the battles of a person who leaves. Each battle is its own batch (ratings in order). */
async function endBattlesOf(db: Database, userId: string, now: number) {
  // A subquery, not a list of ids: D1 allows at most 100 bound parameters.
  const mine = db
    .select({ battleId: battleParticipants.battleId })
    .from(battleParticipants)
    .where(eq(battleParticipants.userId, userId));
  const running = await db
    .select()
    .from(battles)
    .where(
      and(
        inArray(battles.status, ['open', 'negotiating', 'active', 'reviewing']),
        or(eq(battles.invitedUserId, userId), inArray(battles.id, mine)),
      ),
    )
    .orderBy(battles.createdAt);
  for (const battle of running) {
    if (battle.status === 'active' || battle.status === 'reviewing') {
      const seatOrder = (
        await db
          .select({ userId: battleParticipants.userId })
          .from(battleParticipants)
          .where(eq(battleParticipants.battleId, battle.id))
          .orderBy(battleParticipants.seat)
      ).map((p) => p.userId);
      const winner = seatOrder.find((id) => id !== userId);
      if (winner && seatOrder.length === 2) {
        await runBatch(
          db,
          await decideStatements(db, battle, winnerScores(seatOrder, winner), 'forfeit', now),
        );
        continue;
      }
    }
    await runBatch(db, cancelStatements(db, battle.id, 'account_deleted', now));
  }
}

/** Deletes the account; returns the deletion link token (shown once, stored only as a hash). */
export async function deleteAccount(
  db: Database,
  userId: string,
  keepVideos: boolean,
  now = Date.now(),
): Promise<string> {
  await endBattlesOf(db, userId, now);

  const token = toBase64Url(randomBytes(32));
  const statements: BatchItem<'sqlite'>[] = [
    db
      .update(users)
      .set({
        username: `deleted-${userId.replaceAll('-', '').slice(-12)}`,
        displayName: 'Deleted user',
        email: null,
        passwordHash: null,
        questionnaireJson: null,
        athleteCode: null,
        status: 'deleted',
        deletedAt: now,
        deletionTokenHash: await sha256Hex(token),
      })
      .where(eq(users.id, userId)),
    db.delete(sessions).where(eq(sessions.userId, userId)),
    db.delete(oauthAccounts).where(eq(oauthAccounts.userId, userId)),
    db.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, userId)),
    db
      .update(userRoles)
      .set({ revokedAt: now })
      .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt))),
    db.delete(battleMessages).where(eq(battleMessages.senderId, userId)),
    db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)),
    db.delete(notifications).where(eq(notifications.userId, userId)),
    auditInsert(
      db,
      {
        actorId: userId,
        action: 'user.delete_self',
        targetType: 'user',
        targetId: userId,
        payload: { keepVideos },
      },
      now,
    ),
  ];
  if (!keepVideos) statements.push(deleteVideosOfStatement(db, userId, now));
  await runBatch(db, statements);
  return token;
}

/** Marks all videos of a person as deleted; the hourly job removes the files. */
export function deleteVideosOfStatement(db: Database, userId: string, now: number) {
  return db
    .update(videos)
    .set({ status: 'deleted', deletedAt: now })
    .where(
      and(
        eq(videos.ownerId, userId),
        inArray(videos.status, ['pending_upload', 'uploaded', 'processing', 'ready']),
      ),
    );
}
