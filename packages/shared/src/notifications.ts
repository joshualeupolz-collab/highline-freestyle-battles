import { z } from 'zod';

/**
 * What a person can be notified about (owner, 2026-10-12): opponent accepted, videos unlocked,
 * review needed, chat message. Each can be turned off in the profile.
 */
export const NOTIFICATION_KINDS = ['accepted', 'unlocked', 'review', 'chat'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** PUT /api/push/settings: the kinds turned off (all others are on). */
export const notificationSettingsSchema = z.object({
  off: z.array(z.enum(NOTIFICATION_KINDS)).max(NOTIFICATION_KINDS.length),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
