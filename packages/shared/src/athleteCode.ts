/**
 * Filming by friends (concept section 6, stage 2 plan §3.7): every athlete has a code they can
 * change. Whoever knows it can film attempts for the athlete without an account.
 */
import { z } from 'zod';
import {
  createVideoSchema,
  registerAttemptSchema,
  VIDEO_RETENTION_VALUES,
  VIDEO_VISIBILITY_VALUES,
} from './videos';

/** No 0/O, 1/I/L: easy to read out and type. 8 of 31 characters ≈ 40 bits. */
export const ATHLETE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ATHLETE_CODE_LENGTH = 8;

/** Upper case, without spaces and dashes. */
export function normalizeAthleteCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Shown as two groups: `K7M2-QX9P`. */
export function formatAthleteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export const athleteCodeSchema = z
  .string()
  .max(20)
  .transform(normalizeAthleteCode)
  .pipe(z.string().length(ATHLETE_CODE_LENGTH));

/** POST /api/guest/lookup: whose code it is and which battles can be filmed. */
export const guestLookupSchema = z.object({
  code: athleteCodeSchema,
  /** Battles that were running at this time (an attempt recorded offline); default: now. */
  at: z.number().int().positive().optional(),
});

/** POST /api/guest/attempts: Start pressed on the friend's phone. */
export const guestAttemptSchema = registerAttemptSchema.extend({
  code: athleteCodeSchema,
  /** null = recorded offline: goes to the athlete's inbox and is assigned later. */
  battleId: z.uuid().nullable(),
  recorderName: z.string().trim().max(60).optional(),
  /** Offline: opponent, format … so the right battle can be found later. */
  description: z.string().trim().max(300).optional(),
});
export type GuestAttempt = z.infer<typeof guestAttemptSchema>;

/** POST /api/guest/videos: like POST /api/videos, with the code instead of a login. */
export const guestVideoSchema = createVideoSchema.extend({ code: athleteCodeSchema });
export type GuestVideo = z.infer<typeof guestVideoSchema>;

export const guestCodeSchema = z.object({ code: athleteCodeSchema });

/** Assign an inbox video to a battle that was running when it was recorded. */
export const assignAttemptSchema = z.object({
  battleId: z.uuid(),
  partIndex: z.number().int().min(0).max(19),
});
export type AssignAttempt = z.infer<typeof assignAttemptSchema>;

export const guestAssignSchema = assignAttemptSchema.extend({ code: athleteCodeSchema });

/** The opponent confirms that a later assigned video belongs to the battle, or rejects it. */
export const assignmentDecisionSchema = z.object({ action: z.enum(['confirm', 'reject']) });

/** The owner changes who may watch a video and whether it is kept after the battle. */
export const videoSettingsSchema = z.object({
  visibility: z.enum(VIDEO_VISIBILITY_VALUES),
  retention: z.enum(VIDEO_RETENTION_VALUES),
});
export type VideoSettings = z.infer<typeof videoSettingsSchema>;
