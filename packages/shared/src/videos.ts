/**
 * Recording, upload and the attempt that counts (concept sections 5 and 6, architecture step 8).
 * Used by the API (checks) and the web app (the same rules shown before recording).
 */
import { z } from 'zod';

export const VIDEO_QUALITY_VALUES = ['saver', 'normal', 'hd'] as const;
export const VIDEO_VISIBILITY_VALUES = ['public', 'logged_in', 'review_only'] as const;
export type VideoVisibility = (typeof VIDEO_VISIBILITY_VALUES)[number];
export const VIDEO_RETENTION_VALUES = ['delete_after_battle', 'keep'] as const;
/** Why a recording ended; anything but `stopped` means it was cut off (concept section 6). */
export const VIDEO_END_REASONS = ['stopped', 'app_left', 'camera_lost'] as const;

/**
 * Largest video we accept. 60 s in HD are about 45–60 MB; anything bigger should be cut first.
 * Stays below the 100 MB request limit of Workers Free, which applies when uploads go through
 * the Worker (local development, or before the R2 access keys are set up).
 */
export const MAX_VIDEO_BYTES = 95_000_000;

export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm'] as const;

/** Pressing Start creates an attempt on the phone; it is sent as soon as there is a connection. */
export const registerAttemptSchema = z.object({
  /** UUIDv7 created on the phone. Sending the same attempt twice is fine. */
  id: z.uuid(),
  partIndex: z.number().int().min(0).max(19),
  round: z.number().int().min(1).max(20).default(1),
  /** When Start was pressed (phone clock, ms since the epoch). */
  startedAt: z.number().int().positive(),
});
export type RegisterAttempt = z.infer<typeof registerAttemptSchema>;

/** Announce the upload of an attempt's video; the answer says where to send the bytes. */
export const createVideoSchema = z.object({
  attemptId: z.uuid(),
  contentType: z.enum(VIDEO_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_VIDEO_BYTES),
  durationMs: z.number().int().nonnegative().max(3_600_000).nullable().default(null),
  /** Cut points in the original recording; set when the phone could not cut (cut on the server later). */
  trimStartMs: z.number().int().nonnegative().nullable().default(null),
  trimEndMs: z.number().int().nonnegative().nullable().default(null),
  quality: z.enum(VIDEO_QUALITY_VALUES).default('normal'),
  visibility: z.enum(VIDEO_VISIBILITY_VALUES).default('public'),
  retention: z.enum(VIDEO_RETENTION_VALUES).default('delete_after_battle'),
  endReason: z.enum(VIDEO_END_REASONS).default('stopped'),
});
export type CreateVideo = z.infer<typeof createVideoSchema>;

/** Choose the attempt that counts for its part (best of N). Possible until the videos unlock. */
export const submitVideoSchema = z.object({ videoId: z.uuid() });

/** Where and how the phone sends the video bytes. */
export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** Key of one video slot: a part in a round. */
export function slotKey(partIndex: number, round: number): string {
  return `${partIndex}:${round}`;
}

/**
 * Attempts left for one slot, or null for unlimited.
 *
 * Every part (and round) has `attemptsPerVideo` attempts. Extra attempts granted as goodwill are
 * one shared pool for the whole battle: they are used by any attempt beyond the normal number.
 */
export function attemptsLeft(
  attemptsPerVideo: number | null,
  extraAttempts: number,
  usedBySlot: ReadonlyMap<string, number>,
  slot: string,
): number | null {
  if (attemptsPerVideo === null) return null;
  let extraUsed = 0;
  for (const used of usedBySlot.values()) extraUsed += Math.max(0, used - attemptsPerVideo);
  const normalLeft = Math.max(0, attemptsPerVideo - (usedBySlot.get(slot) ?? 0));
  return normalLeft + Math.max(0, extraAttempts - extraUsed);
}
