/**
 * All permission rules in one place (CLAUDE.md, architecture rule 5).
 * Routes ask these functions instead of checking roles themselves.
 */
import {
  type CurrentUser,
  grantableRoles,
  type Role,
  type SpecialRole,
  type VideoVisibility,
} from '@hfb/shared';

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

  /** Hand out or take back a role (`grantableRoles`). Nobody changes their own roles. */
  changeRole: (user: CurrentUser | null, role: SpecialRole, targetUserId: string) =>
    !!user &&
    user.status === 'active' &&
    user.id !== targetUserId &&
    grantableRoles(user.roles).includes(role),

  /** See and close reports (concept section 11). Not for reports that concern oneself. */
  handleReports: (user: CurrentUser | null) => hasRole(user, 'federation', 'admin'),

  /** Create competitions and enter their results (concept section 2). */
  organizeCompetitions: (user: CurrentUser | null) => hasRole(user, 'organizer', 'federation'),

  /** Confirm a competition's results (concept section 8). Not one's own competition. */
  confirmCompetitions: (user: CurrentUser | null) => hasRole(user, 'judge', 'federation'),

  /** Read the audit log (concept section 2: the federation can view it). */
  viewAuditLog: (user: CurrentUser | null) => hasRole(user, 'federation', 'admin'),

  /** Hand out a password reset code (there is no reset by e-mail). Not for oneself. */
  createPasswordResetCode: (user: CurrentUser | null, targetUserId: string) =>
    hasRole(user, 'federation', 'admin') && user?.id !== targetUserId,
};

/**
 * Who may watch a video (concept sections 5.4 and 12):
 * - the owner, always;
 * - a video that counts in a battle, once the videos are unlocked: the participants, and other
 *   logged-in users unless it is "review only" (visibility `public` is treated like `logged_in`
 *   until there are public pages; reviewers of levels 2–3 follow in stage 2);
 * - the opponent, for a cut-off video attached to a request for an extra attempt;
 * - the reviewers of levels 2–3 (pool, judge) while they review it, even "review only".
 * Attempts that do not count stay private.
 */
export function canViewVideo(input: {
  viewerId: string | null;
  ownerId: string;
  isParticipant: boolean;
  submitted: boolean;
  unlocked: boolean;
  visibility: VideoVisibility;
  sharedWithOpponent: boolean;
  /** The viewer reviews this battle (pool or judge, `reviewerRole`). */
  isReviewer?: boolean;
}): boolean {
  if (input.viewerId === null) return false;
  if (input.viewerId === input.ownerId) return true;
  if (input.isParticipant && input.sharedWithOpponent) return true;
  if (!input.submitted || !input.unlocked) return false;
  return input.isParticipant || !!input.isReviewer || input.visibility !== 'review_only';
}
