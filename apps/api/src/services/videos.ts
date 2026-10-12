/**
 * Attempts, uploaded videos and the attempt that counts (concept sections 5.3–5.4 and 6).
 * Shared by the battle and video routes and the scheduled job.
 */
import { and, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { canViewVideo } from '../auth/permissions';
import { deliveryStatus } from '../battles/rules';
import type { Database } from '../db/client';
import { attempts, battleProposals, battles, submissions, videoFiles, videos } from '../db/schema';
import type { VideoStore } from '../storage/videoStore';
import { cancelPendingProposalsStatement, requiredSubmissionsPerPerson } from './battles';
import { reviewerRole } from './review';

type BattleRow = typeof battles.$inferSelect;

/** Videos unlock once everyone has submitted (concept 5.4): from `reviewing` on. */
export function isUnlocked(status: BattleRow['status']): boolean {
  return status === 'reviewing' || status === 'decided' || status === 'annulled';
}

/** Video ids the owner attached to an extra-attempt request: the opponent may watch those. */
async function sharedVideoIds(db: Database, battleId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ proposedBy: battleProposals.proposedBy, payloadJson: battleProposals.payloadJson })
    .from(battleProposals)
    .where(and(eq(battleProposals.battleId, battleId), eq(battleProposals.kind, 'extra_attempt')));
  const shared = new Map<string, string>();
  for (const row of rows) {
    const videoId = (JSON.parse(row.payloadJson) as { videoId?: string }).videoId;
    if (videoId) shared.set(videoId, row.proposedBy);
  }
  return shared;
}

/**
 * Video part of the battle response. Everyone sees how many attempts each side recorded and
 * uploaded and whether it has chosen; the chosen videos only once they are unlocked.
 * The viewer's own attempts are listed in full.
 */
export async function battleVideosView(
  db: Database,
  battle: BattleRow,
  participantIds: readonly string[],
  viewerId: string | null,
  isReviewer = false,
) {
  const [attemptRows, videoRows, submissionRows, shared] = await Promise.all([
    db
      .select({
        id: attempts.id,
        userId: attempts.userId,
        partIndex: attempts.partIndex,
        round: attempts.round,
        startedAt: attempts.startedAtClient,
        codeUsed: attempts.codeUsed,
        recorderName: attempts.recorderName,
        provisional: attempts.provisional,
      })
      .from(attempts)
      .where(eq(attempts.battleId, battle.id))
      .orderBy(attempts.startedAtClient),
    db.select().from(videos).where(eq(videos.battleId, battle.id)),
    db.select().from(submissions).where(eq(submissions.battleId, battle.id)),
    sharedVideoIds(db, battle.id),
  ]);
  const unlocked = isUnlocked(battle.status);
  const isParticipant = viewerId !== null && participantIds.includes(viewerId);
  const videoByAttempt = new Map(videoRows.map((v) => [v.attemptId, v]));
  const uploaded = (v: (typeof videoRows)[number] | undefined) =>
    !!v && (v.status === 'uploaded' || v.status === 'ready');

  const slots = new Map<
    string,
    {
      userId: string;
      partIndex: number;
      round: number;
      attempts: number;
      /** Beyond the allowance: cannot be chosen (concept section 6). */
      provisional: number;
      uploaded: number;
      submittedAt: number | null;
      videoId: string | null;
    }
  >();
  const slotOf = (userId: string, partIndex: number, round: number) => {
    const key = `${userId}:${partIndex}:${round}`;
    let slot = slots.get(key);
    if (!slot) {
      slot = {
        userId,
        partIndex,
        round,
        attempts: 0,
        provisional: 0,
        uploaded: 0,
        submittedAt: null,
        videoId: null,
      };
      slots.set(key, slot);
    }
    return slot;
  };
  for (const a of attemptRows) {
    const slot = slotOf(a.userId, a.partIndex, a.round);
    slot.attempts++;
    if (a.provisional) slot.provisional++;
    if (uploaded(videoByAttempt.get(a.id))) slot.uploaded++;
  }
  for (const s of submissionRows) {
    const slot = slotOf(s.userId, s.partIndex, s.round);
    slot.submittedAt = s.submittedAt;
    const video = videoRows.find((v) => v.id === s.videoId);
    const visible =
      !!video &&
      canViewVideo({
        viewerId,
        ownerId: s.userId,
        isParticipant,
        submitted: true,
        unlocked,
        visibility: video.visibility,
        sharedWithOpponent: false,
        isReviewer,
      });
    if (visible) slot.videoId = s.videoId;
  }

  const submittedVideoIds = new Set(submissionRows.map((s) => s.videoId));
  const videoView = (v: (typeof videoRows)[number]) => ({
    id: v.id,
    status: v.status,
    quality: v.quality,
    durationMs: v.durationMs,
    endReason: v.endReason,
    visibility: v.visibility,
    retention: v.retention,
    uploadedAt: v.uploadedAt,
    counts: submittedVideoIds.has(v.id),
  });
  const mine = isParticipant
    ? attemptRows
        .filter((a) => a.userId === viewerId)
        .map((a) => {
          const video = videoByAttempt.get(a.id);
          return {
            id: a.id,
            partIndex: a.partIndex,
            round: a.round,
            startedAt: a.startedAt,
            provisional: a.provisional,
            ...friendView(a),
            video: video && video.status !== 'deleted' ? videoView(video) : null,
          };
        })
    : [];
  // Attempts friends filmed for the others (concept section 6): who filmed and when. The code
  // itself is not shown (the opponent could use up the athlete's attempts with it).
  const byFriends = isParticipant
    ? attemptRows
        .filter((a) => a.userId !== viewerId && a.codeUsed !== null)
        .map((a) => ({
          id: a.id,
          userId: a.userId,
          partIndex: a.partIndex,
          startedAt: a.startedAt,
          ...friendView(a),
        }))
    : [];
  // Cut-off videos the opponent attached to an extra-attempt request.
  const sharedWithMe = isParticipant
    ? videoRows
        .filter((v) => shared.get(v.id) === v.ownerId && v.ownerId !== viewerId)
        .filter((v) => uploaded(v))
        .map((v) => ({ id: v.id, ownerId: v.ownerId, partIndex: v.partIndex, round: v.round }))
    : [];

  return { unlocked, slots: [...slots.values()], mine, sharedWithMe, byFriends };
}

/** Filming by friends: null for the athlete's own recordings. */
function friendView(a: { codeUsed: string | null; recorderName: string | null }) {
  return { friend: a.codeUsed === null ? null : { name: a.recorderName } };
}

/**
 * May `viewerId` watch this video? Loads what `canViewVideo` needs.
 */
export async function mayViewVideo(
  db: Database,
  video: typeof videos.$inferSelect,
  viewerId: string,
  participantIds: readonly string[],
  battle: BattleRow | null,
): Promise<boolean> {
  if (video.ownerId === viewerId) return true;
  if (!video.battleId || battle === null) return false;
  const battleStatus = battle.status;
  const submitted = await db
    .select({ videoId: submissions.videoId })
    .from(submissions)
    .where(eq(submissions.videoId, video.id))
    .get();
  const shared = (await sharedVideoIds(db, video.battleId)).get(video.id) === video.ownerId;
  return canViewVideo({
    viewerId,
    ownerId: video.ownerId,
    isParticipant: participantIds.includes(viewerId),
    submitted: !!submitted,
    unlocked: isUnlocked(battleStatus),
    visibility: video.visibility,
    sharedWithOpponent: shared,
    isReviewer:
      video.visibility === 'review_only' &&
      (await reviewerRole(db, battle, participantIds, viewerId)) !== null,
  });
}

/**
 * After a submission: if everyone has chosen a video for every part, unlock the videos
 * (status `reviewing`). Runs after the submission was written, so of two people submitting at
 * the same moment, at least the later one sees both submissions.
 */
export async function unlockIfComplete(
  db: Database,
  battle: BattleRow,
  participantIds: readonly string[],
  now: number,
): Promise<boolean> {
  const required = await requiredSubmissionsPerPerson(db, battle);
  const subs = await db
    .select({ userId: submissions.userId })
    .from(submissions)
    .where(eq(submissions.battleId, battle.id));
  if (deliveryStatus(participantIds, subs, required).missing.length > 0) return false;
  await db.batch([
    db
      .update(battles)
      .set({ status: 'reviewing', playedAt: now })
      .where(and(eq(battles.id, battle.id), eq(battles.status, 'active'))),
    // Open proposals (more time, extra attempts, …) no longer matter.
    cancelPendingProposalsStatement(db, battle.id, now),
  ]);
  return true;
}

/** Uploads announced but never finished are removed after this long. */
export const STALE_UPLOAD_MS = 2 * 86_400_000;

/**
 * Scheduled job: delete the files of uploads that were announced but never completed (e.g. an
 * upload URL used for something else, or a phone that never came back). The video row stays;
 * the phone can announce the upload again. Returns how many files were removed.
 */
export async function removeStaleUploads(
  db: Database,
  store: VideoStore,
  now = Date.now(),
): Promise<number> {
  const stale = await db
    .select({ fileId: videoFiles.id, locator: videoFiles.locator })
    .from(videoFiles)
    .innerJoin(videos, eq(videos.id, videoFiles.videoId))
    .where(
      and(
        eq(videos.status, 'pending_upload'),
        isNull(videoFiles.deletedAt),
        lt(videoFiles.createdAt, now - STALE_UPLOAD_MS),
      ),
    )
    .limit(50);
  if (stale.length === 0) return 0;
  await store.delete(stale.map((f) => f.locator));
  await db
    .update(videoFiles)
    .set({ deletedAt: now })
    .where(
      inArray(
        videoFiles.id,
        stale.map((f) => f.fileId),
      ),
    );
  return stale.length;
}

/** Videos a battle no longer needs are deleted this long after it ended (decided 2026-10-11). */
export const VIDEO_CLEANUP_DAYS = 7;

/**
 * Scheduled job, part 1: marks videos as deleted that are no longer needed after a battle ended
 * (concept sections 6 and 12): attempts that did not count unless the owner keeps them, and
 * "review only" videos. Returns how many were marked; part 2 removes their files.
 */
export async function markUnneededVideos(db: Database, now = Date.now()): Promise<number> {
  const rows = await db
    .select({ id: videos.id })
    .from(videos)
    .innerJoin(battles, eq(battles.id, videos.battleId))
    .leftJoin(submissions, eq(submissions.videoId, videos.id))
    .where(
      and(
        inArray(battles.status, ['decided', 'cancelled', 'annulled']),
        lt(battles.endedAt, now - VIDEO_CLEANUP_DAYS * 86_400_000),
        ne(videos.status, 'deleted'),
        or(
          and(isNull(submissions.videoId), eq(videos.retention, 'delete_after_battle')),
          eq(videos.visibility, 'review_only'),
        ),
      ),
    )
    // D1 allows at most 100 bound parameters per query (the ids below).
    .limit(90);
  if (rows.length === 0) return 0;
  await markVideosDeleted(
    db,
    rows.map((r) => r.id),
    now,
  );
  return rows.length;
}

export function markVideosDeleted(db: Database, ids: string[], now: number) {
  return db
    .update(videos)
    .set({ status: 'deleted', deletedAt: now })
    .where(and(inArray(videos.id, ids), ne(videos.status, 'deleted')));
}

/**
 * Scheduled job, part 2: removes the stored files of deleted videos from every storage location
 * ("deletions must apply everywhere"). Today that is R2 only. Returns how many files were removed.
 */
export async function deleteFilesOfDeletedVideos(
  db: Database,
  store: VideoStore,
  now = Date.now(),
): Promise<number> {
  const files = await db
    .select({ id: videoFiles.id, locator: videoFiles.locator, backend: videoFiles.backend })
    .from(videoFiles)
    .innerJoin(videos, eq(videos.id, videoFiles.videoId))
    .where(and(eq(videos.status, 'deleted'), isNull(videoFiles.deletedAt)))
    .limit(90);
  const r2 = files.filter((f) => f.backend === store.backend);
  if (r2.length === 0) return 0;
  await store.delete(r2.map((f) => f.locator));
  await db
    .update(videoFiles)
    .set({ deletedAt: now })
    .where(
      inArray(
        videoFiles.id,
        r2.map((f) => f.id),
      ),
    );
  return r2.length;
}
