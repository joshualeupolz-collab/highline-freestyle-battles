import { z } from 'zod';

/** Roles of a person (concept section 2). A guest is anyone without an account. */
export const ROLES = ['athlete', 'judge', 'organizer', 'federation', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['pending', 'active', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** What GET /api/auth/me and login return. */
export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  status: UserStatus;
  roles: Role[];
  /** Version of the terms of use the person accepted (`TERMS_VERSION`), or null. */
  termsVersion: string | null;
}

/** Roles handed out by hand (the athlete role comes with the approval). */
export const SPECIAL_ROLES = ['judge', 'organizer', 'federation', 'admin'] as const;
export type SpecialRole = (typeof SPECIAL_ROLES)[number];

/** Hand out or take back a role; the reason goes into the audit log. */
export const roleChangeRequestSchema = z.object({
  role: z.enum(SPECIAL_ROLES),
  reason: z.string().trim().max(500).optional(),
});
export type RoleChangeRequest = z.infer<typeof roleChangeRequestSchema>;

/**
 * The roles a person may hand out and take back (concept section 2): the federation assigns
 * judges and organizers and can add federation members; admins can also add admins. Checked by
 * the API (`can.changeRole`), used by the app to show the buttons.
 */
export function grantableRoles(roles: readonly Role[]): SpecialRole[] {
  if (roles.includes('admin')) return [...SPECIAL_ROLES];
  if (roles.includes('federation')) return ['judge', 'organizer', 'federation'];
  return [];
}
