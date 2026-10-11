/** Formats and their parts (concept section 4). */
import { z } from 'zod';

export const FORMAT_STATUSES = ['relevant', 'fun'] as const;
export const FORMAT_PART_KINDS = ['best_trick', 'trick_combo', 'bounce_combo', 'response'] as const;

/** One part of a format, e.g. "3-Trick Combo" = one part `{ kind: 'trick_combo', count: 3 }`. */
export const formatPartSchema = z
  .object({
    kind: z.enum(FORMAT_PART_KINDS),
    /** Number of tricks or bounces; 1 for a best trick. */
    count: z.number().int().min(1).max(100),
    label: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
export type FormatPart = z.infer<typeof formatPartSchema>;

export const formatPartsSchema = z.array(formatPartSchema).min(1).max(10);

export const createFormatRequestSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and single dashes'),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).optional(),
  status: z.enum(FORMAT_STATUSES).default('relevant'),
  /** Exponent for points → score; omitted = RuleSet default. */
  kPoints: z.number().positive().max(10).nullable().optional(),
  parts: formatPartsSchema,
});
export type CreateFormatRequest = z.infer<typeof createFormatRequestSchema>;

export const updateFormatRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(500).nullable(),
    status: z.enum(FORMAT_STATUSES),
    kPoints: z.number().positive().max(10).nullable(),
    reason: z.string().trim().max(500),
  })
  .partial()
  .refine((v) => Object.keys(v).some((k) => k !== 'reason'), 'Nothing to change');

export const newFormatVersionRequestSchema = z.object({
  parts: formatPartsSchema,
  reason: z.string().trim().max(500).optional(),
});
