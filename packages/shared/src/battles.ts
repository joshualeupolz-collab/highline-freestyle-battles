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
  /**
   * Extra attempts. `change: -1` takes back one given by mistake (the opponent who received it
   * must agree). `change: 1` asks the opponent for one more attempt for myself, e.g. after a
   * recording was cut off by leaving the app; the cut-off video can be attached and the
   * opponent may then watch it.
   */
  z.object({
    kind: z.literal('extra_attempt'),
    change: z.union([z.literal(-1), z.literal(1)]),
    videoId: z.uuid().optional(),
  }),
  /** On-site battles: the result as the proposer sees it (5-point scale from seat 0, no draw). */
  z.object({
    kind: z.literal('result'),
    value: z
      .number()
      .int()
      .min(-2)
      .max(2)
      .refine((v) => v !== 0),
  }),
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

/**
 * Review level 1 (concept section 7.1): both athletes vote on the 5-point scale, seen from seat 0:
 * +2 = seat 0 clearly better, +1 somewhat better, 0 can't decide, −1 / −2 the same for seat 1.
 */
export const reviewVoteSchema = z.object({ value: z.number().int().min(-2).max(2) });

/**
 * Days after the videos unlock until the review of level 1 is closed. Without agreement by then
 * (stage 1, decided 2026-10-11): a single vote for one side decides; otherwise the battle ends
 * unrated. Level 2 (athlete pool) takes over this case in stage 2.
 */
export const REVIEW_DAYS = 7;

/** On-site battles (concept section 8): the result counts once the other side confirms it. */
export const ONSITE_CONFIRM_DAYS = 14;
/** How far back an on-site battle may have taken place. */
export const ONSITE_MAX_AGE_DAYS = 60;

export const createOnsiteBattleSchema = z.object({
  formatId: z.string().min(1).max(64),
  opponentId: z.string().min(1).max(64),
  /** When the battle took place (ms since the epoch). */
  playedAt: z.number().int().positive(),
  level: z.number().int().min(1).max(5).default(3),
  scoring: z.enum(ONLINE_SCORINGS).default('scale'),
  /** The result, 5-point scale seen from the person entering it (seat 0): +2 … −2, no draw. */
  value: z
    .number()
    .int()
    .min(-2)
    .max(2)
    .refine((v) => v !== 0, 'No draw'),
});
export type CreateOnsiteBattle = z.infer<typeof createOnsiteBattleSchema>;
