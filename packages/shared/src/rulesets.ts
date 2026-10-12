/** RuleSet parameters (rating specification section 1); mirrors `RuleSetParams` of @hfb/rating. */
import { z } from 'zod';

const weight = z.number().positive().max(10);

export const ruleSetParamsSchema = z
  .object({
    rDefault: z.number().positive(),
    scale: z.number().positive(),
    tau: z.number().positive().max(2),
    sigmaStart: z.number().positive().max(1),
    rdUnknown: z.number().positive(),
    rdStart: z.number().positive(),
    graceDays: z.number().min(0),
    cInact: z.number().min(0),
    kDisplay: z.number().min(0),
    provisionalRd: z.number().positive(),
    minBattles: z.number().int().min(0),
    weights: z.object({ 1: weight, 2: weight, 3: weight, 4: weight, 5: weight }).strict(),
    kPoints: z.number().positive().max(10),
    clamp: z.enum(['winner', 'both', 'none']),
    comboMissingZ: z.number(),
    comboMinPop: z.number().int().min(1),
    comboFallbackSd: z.number().positive(),
    overrateZ: z.number(),
    volatilityEpsilon: z.number().positive().max(0.01),
    /**
     * Official combined ranking (rating spec §8.2): all *relevant* formats (or `formatIds`),
     * the `dropWorst` worst dropped. Missing = 1 (owner, 2026-10-12).
     */
    officialCombo: z
      .object({
        dropWorst: z.number().int().min(0).max(10),
        formatIds: z.array(z.string().min(1).max(64)).max(20).optional(),
      })
      .optional(),
    /** Review levels 2–3 (concept 7.2–7.3); missing values use REVIEW_DEFAULTS. */
    review: z
      .object({
        poolSize: z.number().int().min(1).max(9),
        poolMinBattles: z.number().int().min(0),
        windowBelow: z.number().min(0),
        windowAbove: z.number().min(0),
        widenAfterHours: z.number().min(0),
        widenedAbove: z.number().min(0),
        openAfterDays: z.number().min(0),
        openBelow: z.number().min(0),
        poolMaxDays: z.number().min(0),
      })
      .partial()
      .optional(),
  })
  .strict()
  .refine((p) => p.rdStart <= p.rdUnknown, 'rdStart must not exceed rdUnknown');

export const createRulesetRequestSchema = z.object({
  params: ruleSetParamsSchema,
  /** When the new rules start to apply (milliseconds since the epoch); default: now. */
  validFrom: z.number().int().positive().optional(),
  note: z.string().trim().min(1).max(500),
});

/**
 * Review levels 2–3 (concept 7.2–7.3, decided by the owner 2026-10-12). With R_high = the higher
 * participant rating, the pool is R_high − windowBelow … R_high + windowAbove at first, up to
 * R_high + widenedAbove after `widenAfterHours`, and R_high − openBelow … no upper limit after
 * `openAfterDays`. If the pool is not full after `poolMaxDays`, a judge decides.
 */
export const REVIEW_DEFAULTS = {
  poolSize: 3,
  poolMinBattles: 5,
  windowBelow: 150,
  windowAbove: 150,
  widenAfterHours: 48,
  widenedAbove: 250,
  openAfterDays: 7,
  openBelow: 250,
  poolMaxDays: 14,
} as const;
export type ReviewParams = { [K in keyof typeof REVIEW_DEFAULTS]: number };

/** The review parameters of a RuleSet's params, with defaults for missing values. */
export function reviewParams(params: object): ReviewParams {
  const review = (params as { review?: Partial<ReviewParams> }).review;
  return { ...REVIEW_DEFAULTS, ...review };
}

/** The official combined ranking of a RuleSet's params (default: relevant formats, 1 dropped). */
export function officialCombo(params: object): { dropWorst: number; formatIds?: string[] } {
  return (
    (params as { officialCombo?: { dropWorst: number; formatIds?: string[] } }).officialCombo ?? {
      dropWorst: 1,
    }
  );
}
