/**
 * Filming by friends (concept section 6, stage 2 plan §3.7): every athlete has a code. Whoever
 * knows it can film attempts for the athlete without an account – online only (owner,
 * 2026-10-12). The athlete chooses the code freely (owner, 2026-10-12); a random one is created
 * until then.
 */
import { z } from 'zod';
import {
  createVideoSchema,
  registerAttemptSchema,
  reportReservationSchema,
  reserveAttemptsSchema,
  VIDEO_RETENTION_VALUES,
  VIDEO_VISIBILITY_VALUES,
} from './videos';

/** Random codes: no 0/O, 1/I/L, easy to read out and type. 8 of 31 characters ≈ 40 bits. */
export const ATHLETE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ATHLETE_CODE_LENGTH = 8;
/** Longest code an athlete can choose (only to keep it a code, not a text). */
export const ATHLETE_CODE_MAX = 40;

/**
 * How codes are compared: upper/lower case, spaces and dashes do not matter, so "Anna-Flips",
 * "anna flips" and "ANNAFLIPS" are the same code (and only one athlete can have it).
 */
export function athleteCodeKey(code: string): string {
  return code.toLowerCase().replace(/[\s-]+/g, '');
}

/** A code as typed by a friend: compared by its key. */
export const athleteCodeSchema = z
  .string()
  .max(ATHLETE_CODE_MAX * 2)
  .transform(athleteCodeKey)
  .pipe(z.string().min(1).max(ATHLETE_CODE_MAX));

/** PUT /api/athlete-code: the athlete chooses a code (any text). */
export const chooseAthleteCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .max(ATHLETE_CODE_MAX)
    .refine((c) => athleteCodeKey(c).length > 0, 'empty'),
});

/** POST /api/guest/lookup: whose code it is and which of their battles can be filmed now. */
export const guestLookupSchema = z.object({ code: athleteCodeSchema });

/** POST /api/guest/attempts: Start pressed on the friend's phone (online, battle chosen). */
export const guestAttemptSchema = registerAttemptSchema.extend({
  code: athleteCodeSchema,
  battleId: z.uuid(),
  recorderName: z.string().trim().max(60).optional(),
});
export type GuestAttempt = z.infer<typeof guestAttemptSchema>;

/** POST /api/guest/videos: like POST /api/videos, with the code instead of a login. */
export const guestVideoSchema = createVideoSchema.extend({ code: athleteCodeSchema });
export type GuestVideo = z.infer<typeof guestVideoSchema>;

export const guestCodeSchema = z.object({ code: athleteCodeSchema });

/** POST /api/guest/reservations: a friend prepares for filming offline. */
export const guestReserveSchema = reserveAttemptsSchema.extend({
  code: athleteCodeSchema,
  battleId: z.uuid(),
  recorderName: z.string().trim().max(60).optional(),
});

/** POST /api/guest/reservations/:id/report */
export const guestReportSchema = reportReservationSchema.extend({ code: athleteCodeSchema });

/** The owner changes who may watch a video and whether it is kept after the battle. */
export const videoSettingsSchema = z.object({
  visibility: z.enum(VIDEO_VISIBILITY_VALUES),
  retention: z.enum(VIDEO_RETENTION_VALUES),
});
export type VideoSettings = z.infer<typeof videoSettingsSchema>;
