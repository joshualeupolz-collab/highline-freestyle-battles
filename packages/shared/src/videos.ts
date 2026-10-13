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

/**
 * Every installation of the app and every browser gets its own random device code, stored on the
 * device (concept section 6). Deleting the app or its data gives a new one.
 */
export const deviceCodeSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Pressing Start creates an attempt on the phone; it is sent as soon as there is a connection. */
export const registerAttemptSchema = z.object({
  /** UUIDv7 created on the phone. Sending the same attempt twice is fine. */
  id: z.uuid(),
  partIndex: z.number().int().min(0).max(19),
  round: z.number().int().min(1).max(20).default(1),
  /** When Start was pressed (phone clock, ms since the epoch). */
  startedAt: z.number().int().positive(),
  /** The installation or browser that recorded it (`deviceCodeSchema`). */
  deviceCode: deviceCodeSchema.optional(),
  /** Recorded under this device's reservation for offline recording. */
  reservationId: z.uuid().optional(),
});
export type RegisterAttempt = z.infer<typeof registerAttemptSchema>;

/**
 * "Prepare for offline recording": reserve attempts per part while online. The server reserves
 * at most what is free; with nothing free, the reservation takes over (attempts provisional).
 */
export const reserveAttemptsSchema = z.object({
  deviceCode: deviceCodeSchema,
  parts: z
    .array(
      z.object({
        partIndex: z.number().int().min(0).max(19),
        round: z.number().int().min(1).max(20).default(1),
        count: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(20),
});
export type ReserveAttempts = z.infer<typeof reserveAttemptsSchema>;

/**
 * Back online: the device has registered its attempts. `handBack` frees the unused units (also
 * done automatically once the deadline passed or the battle no longer runs).
 */
export const reportReservationSchema = z.object({
  deviceCode: deviceCodeSchema,
  handBack: z.boolean().default(false),
});

/**
 * Recordings shorter than this do not count as an attempt and are deleted (owner, 2026-10-13):
 * a start that failed or was tapped by mistake. Nobody can do a highline attempt in 3 seconds.
 */
export const MIN_ATTEMPT_MS = 3000;

/** How many days after the deadline the athletes still have to upload and choose (owner, 2026-10-12). */
export const UPLOAD_GRACE_DAYS = 7;

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

/**
 * Upload in parts (R2 multipart upload): big videos are sent in parts so a weak connection only
 * repeats the part that broke off, and an upload continues later where it stopped. R2 needs
 * parts of at least 5 MiB and of equal size (except the last one).
 */
export const UPLOAD_PART_BYTES = 6 * 1024 * 1024;

/** Videos larger than one part are sent in parts; smaller ones with a single PUT. */
export function uploadPartCount(sizeBytes: number): number {
  return sizeBytes > UPLOAD_PART_BYTES ? Math.ceil(sizeBytes / UPLOAD_PART_BYTES) : 1;
}

/** Size of part `partNumber` (1-based) of a video of `sizeBytes`. */
export function uploadPartSize(sizeBytes: number, partNumber: number): number {
  const count = uploadPartCount(sizeBytes);
  if (partNumber < count) return UPLOAD_PART_BYTES;
  return sizeBytes - (count - 1) * UPLOAD_PART_BYTES;
}

/** Answer to announcing a video sent in parts: the phone asks for a target per missing part. */
export interface MultipartUpload {
  uploadId: string;
  partBytes: number;
  partCount: number;
}

/** Ask for the upload targets of some parts (signed URLs expire, so only for the missing ones). */
export const uploadPartsSchema = z.object({
  uploadId: z.string().min(1).max(1024),
  partNumbers: z.array(z.number().int().min(1).max(100)).min(1).max(100),
});

/** One part sent: R2's ETag of it, needed to put the parts together. */
export const uploadedPartSchema = z.object({
  partNumber: z.number().int().min(1).max(100),
  etag: z.string().min(1).max(200),
});
export type UploadedPart = z.infer<typeof uploadedPartSchema>;

/** `POST /videos/:id/complete`: the parts of an upload in parts (nothing for a single PUT). */
export const completeVideoSchema = z.object({
  uploadId: z.string().min(1).max(1024).optional(),
  parts: z.array(uploadedPartSchema).max(100).optional(),
});
export type CompleteVideo = z.infer<typeof completeVideoSchema>;

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

/** One attempt as `settleAttempts` sees it. */
export interface SettleAttempt {
  id: string;
  /** `slotKey(partIndex, round)`. */
  slot: string;
  startedAt: number;
  /** Stored state: beyond the allowance, cannot be chosen (concept section 6). */
  provisional: boolean;
  /** Inside the units of a reservation for offline recording: always valid. */
  covered: boolean;
  /** Chosen as the attempt that counts: never made provisional again. */
  submitted: boolean;
}

/**
 * Which attempts are provisional (concept section 6, decided 2026-10-12). Recording is never
 * blocked: attempts beyond the allowance (agreed attempts + granted extra attempts) are kept but
 * cannot be chosen. Returns the new `provisional` value of every attempt whose value changes.
 *
 * The state is stored and only moves forward, so an attempt that arrives late (recorded offline)
 * never takes the place of an attempt that was already valid:
 * - reserved units (`reservedBySlot`, for offline recording) and valid attempts outside them use
 *   up the allowance;
 * - when there is room (extra attempts granted, reserved units handed back), provisional attempts
 *   become valid in the order they were started;
 * - only when the allowance shrank (an extra attempt taken back) do the latest valid attempts
 *   that were not chosen become provisional again.
 */
export function settleAttempts(
  attemptsPerVideo: number | null,
  extraAttempts: number,
  reservedBySlot: ReadonlyMap<string, number>,
  list: readonly SettleAttempt[],
): Map<string, boolean> {
  const changes = new Map<string, boolean>();
  if (attemptsPerVideo === null) {
    for (const a of list) if (a.provisional) changes.set(a.id, false);
    return changes;
  }
  const sorted = [...list].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
  const used = new Map(reservedBySlot);
  const valid = new Set<string>();
  for (const a of sorted) {
    if (a.covered) {
      valid.add(a.id);
    } else if (!a.provisional) {
      valid.add(a.id);
      used.set(a.slot, (used.get(a.slot) ?? 0) + 1);
    }
  }
  const excess = () => {
    let sum = 0;
    for (const n of used.values()) sum += Math.max(0, n - attemptsPerVideo);
    return sum - extraAttempts;
  };
  // Allowance shrank: the latest valid attempts that were not chosen go back.
  for (const a of [...sorted].reverse()) {
    if (excess() <= 0) break;
    const n = used.get(a.slot) ?? 0;
    if (!valid.has(a.id) || a.covered || a.submitted || n <= attemptsPerVideo) continue;
    valid.delete(a.id);
    used.set(a.slot, n - 1);
  }
  // Room left: provisional attempts become valid in the order they were started.
  for (const a of sorted) {
    if (valid.has(a.id)) continue;
    const left = attemptsLeft(attemptsPerVideo, extraAttempts, used, a.slot);
    if (left !== null && left > 0) {
      valid.add(a.id);
      used.set(a.slot, (used.get(a.slot) ?? 0) + 1);
    }
  }
  for (const a of sorted) {
    const provisional = !valid.has(a.id);
    if (provisional !== a.provisional) changes.set(a.id, provisional);
  }
  return changes;
}
