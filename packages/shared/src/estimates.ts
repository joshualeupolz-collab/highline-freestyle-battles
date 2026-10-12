/**
 * Initial rating estimates (rating specification section 6.1): athletes estimate people they
 * know in a format; the median of at least 3 becomes the starting value. Federation and admins
 * can give an official estimate that overrides the athletes'.
 */
import { z } from 'zod';

/** Allowed range of an estimate (the default rating is 1500). */
export const ESTIMATE_MIN = 500;
export const ESTIMATE_MAX = 3000;

export const createEstimateSchema = z.object({
  subjectId: z.string().min(1).max(64),
  formatId: z.string().min(1).max(64),
  value: z.number().int().min(ESTIMATE_MIN).max(ESTIMATE_MAX),
  /** Official estimate of the federation/admin (overrides the athletes' median). */
  official: z.boolean().default(false),
});
export type CreateEstimate = z.input<typeof createEstimateSchema>;
