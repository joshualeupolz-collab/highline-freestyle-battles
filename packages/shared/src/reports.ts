/**
 * Reports (concept section 11): anyone approved can report a battle, a video or a profile; the
 * federation and admins handle them.
 */
import { z } from 'zod';

export const REPORT_TARGETS = ['battle', 'video', 'user'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_CATEGORIES = [
  'wrong_result',
  'fake_account',
  'inappropriate',
  'privacy',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_STATUSES = ['open', 'closed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1).max(64),
  category: z.enum(REPORT_CATEGORIES),
  text: z.string().trim().min(3).max(1000),
});
export type CreateReport = z.infer<typeof createReportSchema>;

/** Closing a report: what was done (visible to federation and admins only). */
export const closeReportSchema = z.object({ note: z.string().trim().min(3).max(1000) });

/** Annul a decided battle (concept section 11): the result no longer counts for the rating. */
export const annulBattleSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

/**
 * Sport-related actions an admin may only take with a federation member's approval
 * (CLAUDE.md, architecture rule 5). Stored as requests until a federation member decides.
 */
export const FEDERATION_APPROVAL_ACTIONS = ['battle.annul'] as const;
export type FederationApprovalAction = (typeof FEDERATION_APPROVAL_ACTIONS)[number];
export const FEDERATION_APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
] as const;

export const decideApprovalSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).optional(),
});
