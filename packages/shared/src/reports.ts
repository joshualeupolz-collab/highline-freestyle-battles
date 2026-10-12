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
