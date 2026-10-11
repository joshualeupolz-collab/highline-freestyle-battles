/**
 * Allowed values of every enum column.
 *
 * SQLite can only change a CHECK constraint by rebuilding the table, so these lists already
 * contain the values of later development stages (docs/architecture.md section 2). Adding a
 * value later means a table rebuild; prefer adding it here before the first deployment.
 */

export { ROLES, USER_STATUSES } from '@hfb/shared';

export const FORMAT_STATUSES = ['relevant', 'fun'] as const;
export const FORMAT_PART_KINDS = ['best_trick', 'trick_combo', 'bounce_combo', 'response'] as const;

export const COMPETITION_STATUSES = [
  'planned',
  'running',
  'finished',
  'confirmed',
  'cancelled',
] as const;

export const BATTLE_KINDS = ['single', 'group', 'placement'] as const;
export const BATTLE_MODES = ['online', 'onsite'] as const;
export const BATTLE_STATUSES = [
  'open', // request posted, waiting for an opponent
  'negotiating', // opponent found, settings not yet agreed
  'active', // recording and upload
  'reviewing', // all videos submitted, review running
  'decided', // result final, counts for the rating
  'cancelled', // ended without rating
  'annulled', // result removed by the federation
] as const;
export const BATTLE_SCORINGS = ['win_loss', 'scale', 'points', 'placement'] as const;
export const REVIEW_MODES = ['quick', 'detailed'] as const;

export const PROPOSAL_KINDS = [
  'settings',
  'result',
  'draw',
  'cancel',
  'extra_attempt',
  'extension',
] as const;
export const PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn'] as const;
export const PROPOSAL_DECISIONS = ['accept', 'reject'] as const;

export const VIDEO_VISIBILITIES = ['public', 'logged_in', 'review_only'] as const;
export const VIDEO_RETENTIONS = ['delete_after_battle', 'keep'] as const;
export const VIDEO_QUALITIES = ['saver', 'normal', 'hd'] as const;
export const VIDEO_STATUSES = [
  'pending_upload',
  'uploaded',
  'processing',
  'ready',
  'deleted',
] as const;
export const VIDEO_FILE_KINDS = ['original', 'compressed', 'clip', 'thumbnail'] as const;
export const STORAGE_BACKENDS = ['r2', 'telegram', 'disk'] as const;

export const ESTIMATE_KINDS = ['admin', 'federation', 'athlete'] as const;
