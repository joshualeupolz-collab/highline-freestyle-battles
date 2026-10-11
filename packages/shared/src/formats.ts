/** Formats and their parts (concept section 4). */
import { z } from 'zod';

export const FORMAT_STATUSES = ['relevant', 'fun'] as const;
/**
 * What one video of a format contains.
 * - `trick_combo`: a number of tricks; transition bounces between them are allowed.
 *   A best trick is simply 1 trick.
 * - `bounce_combo`: a number of bounces; every bounce counts.
 * - `other`: anything else, described in free text (`label`).
 * `best_trick` (old name for 1 trick) and `response` (back-and-forth, stage 3) stay valid.
 */
export const FORMAT_PART_KINDS = [
  'trick_combo',
  'bounce_combo',
  'other',
  'best_trick',
  'response',
] as const;
/** The kinds offered when creating or proposing a format. */
export const SELECTABLE_PART_KINDS = ['trick_combo', 'bounce_combo', 'other'] as const;

/** One part (= one video) of a format, e.g. `{ kind: 'trick_combo', count: 3 }`. */
export const formatPartSchema = z
  .object({
    kind: z.enum(FORMAT_PART_KINDS),
    /** Number of tricks or bounces; not used for `other`. */
    count: z.number().int().min(1).max(100).optional(),
    /** Free description; required for `other`. */
    label: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((part, ctx) => {
    if (part.kind === 'other' && !part.label) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'Describe what is filmed' });
    }
    if ((part.kind === 'trick_combo' || part.kind === 'bounce_combo') && part.count === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['count'],
        message: 'Number of tricks or bounces is missing',
      });
    }
  });
export type FormatPart = z.infer<typeof formatPartSchema>;

export const formatPartsSchema = z.array(formatPartSchema).min(1).max(10);

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and single dashes');

export const createFormatRequestSchema = z.object({
  /** Short id for links; generated from the name if omitted. */
  slug: slugSchema.optional(),
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

/** Any athlete can propose a format; the federation/admin approves or rejects it. */
export const proposeFormatRequestSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).optional(),
  parts: formatPartsSchema,
});

export const approveFormatRequestSchema = z.object({
  /** relevant = official (shown as a tile), fun = under "more formats". */
  status: z.enum(FORMAT_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export const rejectFormatRequestSchema = z.object({
  /** Shown to the person who proposed the format. */
  note: z.string().trim().min(1).max(500),
});

/** How many open proposals one person may have at a time (prevents spam). */
export const MAX_OPEN_PROPOSALS = 5;
