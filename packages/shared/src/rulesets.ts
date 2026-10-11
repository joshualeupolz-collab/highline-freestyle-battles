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
  })
  .strict()
  .refine((p) => p.rdStart <= p.rdUnknown, 'rdStart must not exceed rdUnknown');

export const createRulesetRequestSchema = z.object({
  params: ruleSetParamsSchema,
  /** When the new rules start to apply (milliseconds since the epoch); default: now. */
  validFrom: z.number().int().positive().optional(),
  note: z.string().trim().min(1).max(500),
});
