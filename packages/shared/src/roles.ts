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
}
