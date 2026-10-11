/**
 * Battle requests, settings and change proposals (concept section 5).
 * Default values are provisional (concept section 15, open question 4) and easy to change here.
 */
import { z } from 'zod';
import { defaultDeadline } from './deadline';

/** Result types for online battles in stage 1 (points/placements come with on-site results). */
export const ONLINE_SCORINGS = ['win_loss', 'scale'] as const;
/** Weight levels anyone may choose; 4–5 need approval by a judge or organizer (stage 2). */
export const MAX_FREE_LEVEL = 3;
export const MAX_ATTEMPTS = 99;

export const battleSettingsSchema = z.object({
  /** Attempts per video: any number up to MAX_ATTEMPTS, or null = unlimited. */
  attemptsPerVideo: z.number().int().min(1).max(MAX_ATTEMPTS).nullable(),
  /** When all videos must be submitted (ms since the epoch); null = no deadline. See deadline.ts. */
  deadlineAt: z.number().int().positive().nullable(),
  /** Weight 1 (fun) … 5 (official competition). */
  level: z.number().int().min(1).max(5),
  scoring: z.enum(ONLINE_SCORINGS),
  /** Detailed mode (score sheets) comes in stage 3. */
  reviewMode: z.enum(['quick']),
});
export type BattleSettings = z.infer<typeof battleSettingsSchema>;

/** Default settings; the deadline depends on the current date. */
export function defaultBattleSettings(now = Date.now()): BattleSettings {
  return {
    attemptsPerVideo: 3,
    deadlineAt: defaultDeadline(now),
    level: 3,
    scoring: 'scale',
    reviewMode: 'quick',
  };
}

export const settingsChangeSchema = battleSettingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export const createBattleRequestSchema = z.object({
  formatId: z.string().min(1).max(64),
  /** Missing values are taken from defaultBattleSettings(). */
  settings: battleSettingsSchema.partial().default({}),
  /** true = the settings are a suggestion and both sides agree on them after acceptance. */
  settingsFlexible: z.boolean().default(false),
  /** Challenge one specific person instead of posting an open request. */
  invitedUserId: z.string().min(1).max(64).optional(),
});
export type CreateBattleRequest = z.infer<typeof createBattleRequestSchema>;

/** A change one side proposes and the other side has to accept. */
export const proposalRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('settings'), changes: settingsChangeSchema }),
  /** More time: new deadline in milliseconds since the epoch. */
  z.object({ kind: z.literal('extension'), deadlineAt: z.number().int().positive() }),
  /** Give up the battle. The other side decides: count it as their win, or cancel unrated. */
  z.object({ kind: z.literal('cancel') }),
  /** Take back one extra attempt given by mistake; the opponent who received it must agree. */
  z.object({ kind: z.literal('extra_attempt'), change: z.literal(-1) }),
]);
export type ProposalRequest = z.infer<typeof proposalRequestSchema>;

export const proposalResponseSchema = z.object({
  decision: z.enum(['accept', 'reject']),
});

/** After a missed deadline, the side that delivered chooses (concept section 5.6). */
export const deadlineDecisionSchema = z.object({
  choice: z.enum(['claim_win', 'cancel']),
});

/**
 * If the side that delivered does not decide within this many days after a missed deadline,
 * the battle counts as their win automatically; if nobody delivered, it is cancelled unrated.
 */
export const AUTO_DECIDE_AFTER_DAYS = 7;

export const MESSAGE_MAX_LENGTH = 1000;

export const sendMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});
