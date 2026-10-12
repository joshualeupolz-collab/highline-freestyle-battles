/**
 * Official competitions (concept section 8, rating specification section 5.2): an organizer
 * creates a competition with a weight 1–5 and enters its results – single battles, or only the
 * final placement per format. They count once a judge or the federation confirms them.
 */
import { z } from 'zod';

export const createCompetitionSchema = z.object({
  name: z.string().trim().min(3).max(100),
  location: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  /** Day of the competition (ms since the epoch). */
  startsAt: z.number().int().positive(),
  endsAt: z.number().int().positive().optional(),
  /** Weight of every battle in it (owner, 2026-10-12: levels 1–5 possible). */
  level: z.number().int().min(1).max(5),
});
export type CreateCompetition = z.infer<typeof createCompetitionSchema>;

/** A single battle of a competition: A against B, 5-point value seen from A, no draw. */
export const competitionBattleSchema = z.object({
  formatId: z.string().min(1).max(64),
  aId: z.string().min(1).max(64),
  bId: z.string().min(1).max(64),
  scoring: z.enum(['scale', 'win_loss']).default('scale'),
  value: z
    .number()
    .int()
    .min(-2)
    .max(2)
    .refine((v) => v !== 0, 'No draw'),
});
export type CompetitionBattle = z.infer<typeof competitionBattleSchema>;

/** The final placement of a competition in one format (used only without single battles). */
export const competitionPlacementSchema = z.object({
  formatId: z.string().min(1).max(64),
  placements: z
    .array(
      z.object({
        userId: z.string().min(1).max(64),
        placement: z.number().int().min(1).max(200),
      }),
    )
    .min(2)
    .max(200)
    .refine((list) => new Set(list.map((p) => p.userId)).size === list.length, 'Everyone once')
    .refine((list) => list.every((p) => p.placement <= list.length), 'Placement too high'),
});
export type CompetitionPlacement = z.infer<typeof competitionPlacementSchema>;
