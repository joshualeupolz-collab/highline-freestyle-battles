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

  /**
   * Create and change formats and RuleSets (sport rules). The federation decides on rules;
   * in stage 1, before the federation role is handed out, the admin does it. Every change
   * goes into the audit log. TODO(stage 2): require federation approval for admins.
   */
  manageRules: (user: CurrentUser | null) => hasRole(user, 'federation', 'admin'),

  /** Request, accept and play battles. */
  battle: (user: CurrentUser | null) => hasRole(user, 'athlete'),

  /** Hand out a password reset code (there is no reset by e-mail). Not for oneself. */
  createPasswordResetCode: (user: CurrentUser | null, targetUserId: string) =>
    hasRole(user, 'federation', 'admin') && user?.id !== targetUserId,
};
