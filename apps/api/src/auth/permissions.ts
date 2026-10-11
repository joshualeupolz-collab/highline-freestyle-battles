/**
 * All permission rules in one place (CLAUDE.md, architecture rule 5).
 * Routes ask these functions instead of checking roles themselves.
 */
import type { CurrentUser, Role } from '@hfb/shared';

export function hasRole(user: CurrentUser | null, ...roles: Role[]): boolean {
  return !!user && user.status === 'active' && roles.some((r) => user.roles.includes(r));
}

export const can = {
  /** Approve new accounts: any athlete, the federation or an admin (concept section 3). */
  approveUsers: (user: CurrentUser | null) => hasRole(user, 'athlete', 'federation', 'admin'),

  /** Hand out a password reset code (there is no reset by e-mail). Not for oneself. */
  createPasswordResetCode: (user: CurrentUser | null, targetUserId: string) =>
    hasRole(user, 'federation', 'admin') && user?.id !== targetUserId,
};
