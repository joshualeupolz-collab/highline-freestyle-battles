/**
 * D1 database schema (docs/architecture.md section 2).
 *
 * This file is the source of truth: `pnpm --filter @hfb/api db:generate` creates the SQL
 * migration in `db/migrations` from it. Never edit a migration that has been applied.
 *
 * Conventions: ids are TEXT (UUIDv7), times are INTEGER milliseconds since the epoch (UTC),
 * booleans are INTEGER 0/1, JSON is TEXT. Every enum column has a CHECK constraint.
 */
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  BATTLE_KINDS,
  BATTLE_MODES,
  BATTLE_SCORINGS,
  BATTLE_STATUSES,
  COMPETITION_STATUSES,
  DECISION_REASONS,
  ESTIMATE_KINDS,
  FEDERATION_APPROVAL_ACTIONS,
  FEDERATION_APPROVAL_STATUSES,
  FORMAT_STATUSES,
  PROPOSAL_DECISIONS,
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  REPORT_TARGETS,
  REVIEW_MODES,
  ROLES,
  STORAGE_BACKENDS,
  USER_STATUSES,
  VIDEO_FILE_KINDS,
  VIDEO_QUALITIES,
  VIDEO_RETENTIONS,
  VIDEO_STATUSES,
  VIDEO_VISIBILITIES,
} from './enums';

/** CHECK constraint "column is one of the allowed values". */
function oneOf(name: string, column: AnySQLiteColumn, values: readonly string[]) {
  const list = sql.raw(values.map((v) => `'${v}'`).join(', '));
  return check(name, sql`${column} IN (${list})`);
}

/** CHECK constraint "column is valid JSON". */
function json(name: string, column: AnySQLiteColumn) {
  return check(name, sql`json_valid(${column})`);
}

function between(name: string, column: AnySQLiteColumn, min: number, max: number) {
  return check(name, sql`${column} BETWEEN ${sql.raw(String(min))} AND ${sql.raw(String(max))}`);
}

const lower = (column: AnySQLiteColumn): SQL => sql`lower(${column})`;

// ---------------------------------------------------------------------------------------------
// Identity and permissions
// ---------------------------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    /** PBKDF2 hash incl. salt and parameters; NULL for Google-only accounts. */
    passwordHash: text('password_hash'),
    status: text('status', { enum: USER_STATUSES }).notNull().default('pending'),
    /** "I am at least 16 years old" was confirmed at this time. */
    ageConfirmedAt: integer('age_confirmed_at'),
    /** Federation note for an approved exception below 16 (parental consent). */
    minorConsentNote: text('minor_consent_note'),
    /** Invitation tree: who approved this account. */
    approvedBy: text('approved_by'),
    approvedAt: integer('approved_at'),
    questionnaireJson: text('questionnaire_json'),
    /** Code for filming by friends (stage 2). */
    athleteCode: text('athlete_code'),
    /** Failed logins in a row; reset on success. Used to slow down password guessing. */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lastFailedLoginAt: integer('last_failed_login_at'),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
    /**
     * Hash of the deletion link handed out when the account was deleted (concept section 12):
     * with it, the person can later have the videos they kept deleted too.
     */
    deletionTokenHash: text('deletion_token_hash'),
    /** Version of the terms of use accepted (`TERMS_VERSION`) and when. */
    termsVersion: text('terms_version'),
    termsAcceptedAt: integer('terms_accepted_at'),
  },
  (t) => [
    uniqueIndex('users_username_unique').on(lower(t.username)),
    uniqueIndex('users_email_unique').on(lower(t.email)),
    uniqueIndex('users_athlete_code_unique').on(t.athleteCode),
    index('users_approved_by_idx').on(t.approvedBy),
    foreignKey({ columns: [t.approvedBy], foreignColumns: [t.id] }),
    oneOf('users_status_check', t.status, USER_STATUSES),
    check(
      'users_questionnaire_json_check',
      sql`${t.questionnaireJson} IS NULL OR json_valid(${t.questionnaireJson})`,
    ),
  ],
);

export const oauthAccounts = sqliteTable(
  'oauth_accounts',
  {
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerUserId] }),
    index('oauth_accounts_user_idx').on(t.userId),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 of the session token; the token itself is never stored. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * One-time codes to set a new password, created by an admin or the federation
 * (there is no "forgot password" e-mail). Only a hash of the code is stored.
 */
export const passwordResetCodes = sqliteTable(
  'password_reset_codes',
  {
    /** SHA-256 of the code. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => [index('password_reset_codes_user_idx').on(t.userId)],
);

export const userRoles = sqliteTable(
  'user_roles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ROLES }).notNull(),
    grantedBy: text('granted_by').references(() => users.id),
    grantedAt: integer('granted_at').notNull(),
    revokedBy: text('revoked_by').references(() => users.id),
    revokedAt: integer('revoked_at'),
  },
  (t) => [
    // At most one active grant per user and role; revoked grants stay as history.
    uniqueIndex('user_roles_active_unique').on(t.userId, t.role).where(sql`${t.revokedAt} IS NULL`),
    oneOf('user_roles_role_check', t.role, ROLES),
  ],
);

/** Every action using special permissions (concept section 2). Append-only. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    reason: text('reason'),
    payloadJson: text('payload_json'),
    /** Federation member who approved a sport-related admin intervention. */
    federationApprovalBy: text('federation_approval_by').references(() => users.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('audit_log_target_idx').on(t.targetType, t.targetId),
    index('audit_log_actor_idx').on(t.actorId),
    index('audit_log_created_idx').on(t.createdAt),
    check(
      'audit_log_payload_json_check',
      sql`${t.payloadJson} IS NULL OR json_valid(${t.payloadJson})`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Rules as data
// ---------------------------------------------------------------------------------------------

/** Versioned rating parameters (`RuleSetParams` of packages/rating). Never changed, only added. */
export const rulesets = sqliteTable(
  'rulesets',
  {
    version: integer('version').primaryKey(),
    paramsJson: text('params_json').notNull(),
    validFrom: integer('valid_from').notNull(),
    note: text('note'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [json('rulesets_params_json_check', t.paramsJson)],
);

export const formats = sqliteTable(
  'formats',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', { enum: FORMAT_STATUSES }).notNull().default('fun'),
    /** Exponent for points → score; NULL = RuleSet default (`kPoints`). */
    kPoints: real('k_points'),
    /** If set, battles of this format count for the target format's rating. */
    mergedInto: text('merged_into'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: integer('created_at').notNull(),
    /**
     * NULL = a proposal by an athlete that is not approved yet; it cannot be used for battles.
     * Formats created by the federation/admin are approved at once.
     */
    approvedAt: integer('approved_at'),
    approvedBy: text('approved_by').references(() => users.id),
    /** Feedback for the proposer, e.g. why a proposal was rejected. */
    reviewNote: text('review_note'),
    /** Archived formats (and rejected proposals) can no longer be chosen. */
    archivedAt: integer('archived_at'),
  },
  (t) => [
    foreignKey({ columns: [t.mergedInto], foreignColumns: [t.id] }),
    index('formats_created_by_idx').on(t.createdBy),
    oneOf('formats_status_check', t.status, FORMAT_STATUSES),
    check('formats_k_points_check', sql`${t.kPoints} IS NULL OR ${t.kPoints} > 0`),
  ],
);

/** Immutable definition of a format: its parts. A battle stores the version it was played with. */
export const formatVersions = sqliteTable(
  'format_versions',
  {
    formatId: text('format_id')
      .notNull()
      .references(() => formats.id),
    version: integer('version').notNull(),
    /** `[{ kind: best_trick|trick_combo|bounce_combo|response, count, label? }]` */
    partsJson: text('parts_json').notNull(),
    createdBy: text('created_by').references(() => users.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.formatId, t.version] }),
    json('format_versions_parts_json_check', t.partsJson),
  ],
);

/** Official competitions (used from stage 2). */
export const competitions = sqliteTable(
  'competitions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    organizerId: text('organizer_id')
      .notNull()
      .references(() => users.id),
    location: text('location'),
    startsAt: integer('starts_at'),
    endsAt: integer('ends_at'),
    status: text('status', { enum: COMPETITION_STATUSES }).notNull().default('planned'),
    confirmedBy: text('confirmed_by').references(() => users.id),
    confirmedAt: integer('confirmed_at'),
    createdAt: integer('created_at').notNull(),
    /** Weight 1–5 of all its battles, set by the organizer beforehand (validated by the app). */
    level: integer('level').notNull().default(3),
    description: text('description'),
  },
  (t) => [
    oneOf('competitions_status_check', t.status, COMPETITION_STATUSES),
    index('competitions_starts_idx').on(t.startsAt),
  ],
);

// ---------------------------------------------------------------------------------------------
// Battles (= rating events)
// ---------------------------------------------------------------------------------------------

export const battles = sqliteTable(
  'battles',
  {
    id: text('id').primaryKey(),
    formatId: text('format_id').notNull(),
    formatVersion: integer('format_version').notNull(),
    rulesetVersion: integer('ruleset_version')
      .notNull()
      .references(() => rulesets.version),
    kind: text('kind', { enum: BATTLE_KINDS }).notNull().default('single'),
    mode: text('mode', { enum: BATTLE_MODES }).notNull().default('online'),
    status: text('status', { enum: BATTLE_STATUSES }).notNull().default('open'),
    /** Weight level 1–5; 4–5 count only after approval. */
    level: integer('level').notNull().default(3),
    levelApprovedBy: text('level_approved_by').references(() => users.id),
    levelApprovedAt: integer('level_approved_at'),
    scoring: text('scoring', { enum: BATTLE_SCORINGS }).notNull().default('scale'),
    reviewMode: text('review_mode', { enum: REVIEW_MODES }).notNull().default('quick'),
    /** Current review level 1 (athletes) … 3 (judges). */
    reviewLevel: integer('review_level').notNull().default(1),
    /** Since when the battle is at its current review level 2 or 3 (pool window, timeouts). */
    reviewLevelSince: integer('review_level_since'),
    rounds: integer('rounds').notNull().default(1),
    /** NULL = unlimited attempts per video. */
    attemptsPerVideo: integer('attempts_per_video'),
    timeWindowHours: integer('time_window_hours'),
    deadlineAt: integer('deadline_at'),
    /** Settings are negotiable instead of fixed by the challenger. */
    settingsFlexible: integer('settings_flexible', { mode: 'boolean' }).notNull().default(false),
    competitionId: text('competition_id').references(() => competitions.id),
    /** Direct challenge: only this person may accept. NULL = open request for everyone. */
    invitedUserId: text('invited_user_id').references(() => users.id),
    /** Why the battle was decided (validated by the app, see DECISION_REASONS). */
    decisionReason: text('decision_reason', { enum: DECISION_REASONS }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    acceptedAt: integer('accepted_at'),
    playedAt: integer('played_at'),
    decidedAt: integer('decided_at'),
    /** Rating event timestamp: when the result became final and counts (spec §2.1). */
    eventAt: integer('event_at'),
    /** When the battle was decided or cancelled (for cleaning up videos afterwards). */
    endedAt: integer('ended_at'),
    cancelReason: text('cancel_reason'),
    annulledBy: text('annulled_by').references(() => users.id),
    annulledAt: integer('annulled_at'),
    annulReason: text('annul_reason'),
  },
  (t) => [
    foreignKey({
      columns: [t.formatId, t.formatVersion],
      foreignColumns: [formatVersions.formatId, formatVersions.version],
    }),
    index('battles_open_idx').on(t.status, t.formatId, t.createdAt),
    index('battles_replay_idx').on(t.formatId, t.eventAt),
    index('battles_competition_idx').on(t.competitionId),
    index('battles_invited_idx').on(t.invitedUserId, t.status),
    index('battles_ended_idx').on(t.endedAt),
    oneOf('battles_kind_check', t.kind, BATTLE_KINDS),
    oneOf('battles_mode_check', t.mode, BATTLE_MODES),
    oneOf('battles_status_check', t.status, BATTLE_STATUSES),
    oneOf('battles_scoring_check', t.scoring, BATTLE_SCORINGS),
    oneOf('battles_review_mode_check', t.reviewMode, REVIEW_MODES),
    between('battles_level_check', t.level, 1, 5),
    between('battles_review_level_check', t.reviewLevel, 1, 3),
    check('battles_rounds_check', sql`${t.rounds} >= 1`),
    check(
      'battles_attempts_check',
      sql`${t.attemptsPerVideo} IS NULL OR ${t.attemptsPerVideo} >= 1`,
    ),
  ],
);

export const battleParticipants = sqliteTable(
  'battle_participants',
  {
    battleId: text('battle_id')
      .notNull()
      .references(() => battles.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** Position 0 … n−1; review votes are given from the view of seat 0. */
    seat: integer('seat').notNull(),
    joinedAt: integer('joined_at').notNull(),
    /** Attempts granted on top of `attempts_per_video` (goodwill). */
    extraAttempts: integer('extra_attempts').notNull().default(0),
    /** Newest chat message this person has seen (for the "new messages" marker). */
    lastReadMessageAt: integer('last_read_message_at'),
    /** Raw result, depending on `battles.scoring`. */
    score: real('score'),
    points: real('points'),
    placement: integer('placement'),
  },
  (t) => [
    primaryKey({ columns: [t.battleId, t.userId] }),
    uniqueIndex('battle_participants_seat_unique').on(t.battleId, t.seat),
    index('battle_participants_user_idx').on(t.userId),
    check('battle_participants_seat_check', sql`${t.seat} >= 0`),
    check('battle_participants_extra_check', sql`${t.extraAttempts} >= 0`),
    check('battle_participants_score_check', sql`${t.score} IS NULL OR ${t.score} BETWEEN 0 AND 1`),
    check('battle_participants_points_check', sql`${t.points} IS NULL OR ${t.points} >= 0`),
  ],
);

/**
 * "Everything can be changed if both sides agree" (concept principle 2): settings changes,
 * on-site results, draws, cancellation, extra attempts, more time.
 */
export const battleProposals = sqliteTable(
  'battle_proposals',
  {
    id: text('id').primaryKey(),
    battleId: text('battle_id')
      .notNull()
      .references(() => battles.id),
    kind: text('kind', { enum: PROPOSAL_KINDS }).notNull(),
    payloadJson: text('payload_json').notNull(),
    proposedBy: text('proposed_by')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: PROPOSAL_STATUSES }).notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    index('battle_proposals_battle_idx').on(t.battleId, t.status),
    oneOf('battle_proposals_kind_check', t.kind, PROPOSAL_KINDS),
    oneOf('battle_proposals_status_check', t.status, PROPOSAL_STATUSES),
    json('battle_proposals_payload_json_check', t.payloadJson),
  ],
);

/**
 * Chat between the participants of a battle. Only participants can read it (later also the
 * federation for a reported battle). Deleting an account deletes its messages.
 */
export const battleMessages = sqliteTable(
  'battle_messages',
  {
    id: text('id').primaryKey(),
    battleId: text('battle_id')
      .notNull()
      .references(() => battles.id),
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    /**
     * Set for entries the app writes itself (proposals, answers, extra attempts, …), so the chat
     * also documents what happened: JSON { type, …details }. `body` is empty then.
     */
    eventJson: text('event_json'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('battle_messages_battle_idx').on(t.battleId, t.createdAt),
    index('battle_messages_sender_idx').on(t.senderId),
  ],
);

export const proposalResponses = sqliteTable(
  'proposal_responses',
  {
    proposalId: text('proposal_id')
      .notNull()
      .references(() => battleProposals.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    decision: text('decision', { enum: PROPOSAL_DECISIONS }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.proposalId, t.userId] }),
    oneOf('proposal_responses_decision_check', t.decision, PROPOSAL_DECISIONS),
  ],
);

// ---------------------------------------------------------------------------------------------
// Recording and video
// ---------------------------------------------------------------------------------------------

/** Pressing Start uses up an attempt (concept section 6). Created on the phone, synced later. */
export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    /** NULL while the video sits in the inbox (filming by friends, stage 2). */
    battleId: text('battle_id').references(() => battles.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    partIndex: integer('part_index').notNull(),
    round: integer('round').notNull().default(1),
    startedAtClient: integer('started_at_client').notNull(),
    syncedAt: integer('synced_at').notNull(),
    /** Stage 2: the person filming (NULL = the athlete or a guest without account). */
    recordedBy: text('recorded_by').references(() => users.id),
    codeUsed: text('code_used'),
    opponentNameEntered: text('opponent_name_entered'),
  },
  (t) => [index('attempts_slot_idx').on(t.battleId, t.userId, t.partIndex, t.round)],
);

export const videos = sqliteTable(
  'videos',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id')
      .notNull()
      .unique()
      .references(() => attempts.id),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    battleId: text('battle_id').references(() => battles.id),
    partIndex: integer('part_index').notNull(),
    round: integer('round').notNull().default(1),
    visibility: text('visibility', { enum: VIDEO_VISIBILITIES }).notNull().default('public'),
    retention: text('retention', { enum: VIDEO_RETENTIONS })
      .notNull()
      .default('delete_after_battle'),
    quality: text('quality', { enum: VIDEO_QUALITIES }).notNull().default('normal'),
    durationMs: integer('duration_ms'),
    trimStartMs: integer('trim_start_ms'),
    trimEndMs: integer('trim_end_ms'),
    /**
     * Why the recording ended: stopped, or cut off by leaving the app / losing the camera
     * (validated by the app, see VIDEO_END_REASONS in @hfb/shared). NULL for older rows.
     */
    endReason: text('end_reason'),
    status: text('status', { enum: VIDEO_STATUSES }).notNull().default('pending_upload'),
    recordedAt: integer('recorded_at').notNull(),
    uploadedAt: integer('uploaded_at'),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('videos_battle_idx').on(t.battleId),
    index('videos_owner_idx').on(t.ownerId),
    index('videos_status_idx').on(t.status),
    oneOf('videos_visibility_check', t.visibility, VIDEO_VISIBILITIES),
    oneOf('videos_retention_check', t.retention, VIDEO_RETENTIONS),
    oneOf('videos_quality_check', t.quality, VIDEO_QUALITIES),
    oneOf('videos_status_check', t.status, VIDEO_STATUSES),
  ],
);

/** Where the bytes of a video are stored. "Delete everywhere" = process every row. */
export const videoFiles = sqliteTable(
  'video_files',
  {
    id: text('id').primaryKey(),
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id),
    kind: text('kind', { enum: VIDEO_FILE_KINDS }).notNull(),
    clipIndex: integer('clip_index'),
    backend: text('backend', { enum: STORAGE_BACKENDS }).notNull(),
    /** Backend-specific location: R2 object key, Telegram message id, disk path. */
    locator: text('locator').notNull(),
    sizeBytes: integer('size_bytes'),
    /** MIME type of the stored file, e.g. video/mp4. */
    contentType: text('content_type'),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('video_files_video_idx').on(t.videoId),
    oneOf('video_files_kind_check', t.kind, VIDEO_FILE_KINDS),
    oneOf('video_files_backend_check', t.backend, STORAGE_BACKENDS),
  ],
);

/** The attempt an athlete chose to count (best of N), one per part and round. */
export const submissions = sqliteTable(
  'submissions',
  {
    battleId: text('battle_id')
      .notNull()
      .references(() => battles.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    partIndex: integer('part_index').notNull(),
    round: integer('round').notNull().default(1),
    videoId: text('video_id')
      .notNull()
      .unique()
      .references(() => videos.id),
    submittedAt: integer('submitted_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.userId, t.partIndex, t.round] })],
);

// ---------------------------------------------------------------------------------------------
// Review and rating
// ---------------------------------------------------------------------------------------------

export const reviewVotes = sqliteTable(
  'review_votes',
  {
    battleId: text('battle_id')
      .notNull()
      .references(() => battles.id),
    voterId: text('voter_id')
      .notNull()
      .references(() => users.id),
    reviewLevel: integer('review_level').notNull(),
    /** 5-point scale seen from seat 0: +2 clearly better … −2 clearly worse. */
    value: integer('value').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.battleId, t.voterId, t.reviewLevel] }),
    between('review_votes_level_check', t.reviewLevel, 1, 3),
    between('review_votes_value_check', t.value, -2, 2),
  ],
);

export const ratingEstimates = sqliteTable(
  'rating_estimates',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => users.id),
    estimatorId: text('estimator_id')
      .notNull()
      .references(() => users.id),
    formatId: text('format_id')
      .notNull()
      .references(() => formats.id),
    kind: text('kind', { enum: ESTIMATE_KINDS }).notNull(),
    value: real('value').notNull(),
    createdAt: integer('created_at').notNull(),
    withdrawnAt: integer('withdrawn_at'),
  },
  (t) => [
    index('rating_estimates_subject_idx').on(t.subjectId, t.formatId),
    oneOf('rating_estimates_kind_check', t.kind, ESTIMATE_KINDS),
  ],
);

/** Derived cache, can be regenerated by a replay at any time. */
export const ratingStates = sqliteTable(
  'rating_states',
  {
    formatId: text('format_id')
      .notNull()
      .references(() => formats.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    r: real('r').notNull(),
    rd: real('rd').notNull(),
    sigma: real('sigma').notNull(),
    lastEventAt: integer('last_event_at'),
    nBattles: integer('n_battles').notNull(),
    rulesetVersion: integer('ruleset_version')
      .notNull()
      .references(() => rulesets.version),
    computedAt: integer('computed_at').notNull(),
  },
  // Format first: a ranking reads all states of one format through the primary key.
  (t) => [primaryKey({ columns: [t.formatId, t.userId] })],
);

/** Derived, one row per participant and battle (e.g. for the "+12" display). */
export const ratingHistory = sqliteTable(
  'rating_history',
  {
    battleId: text('battle_id')
      .notNull()
      .references(() => battles.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    formatId: text('format_id')
      .notNull()
      .references(() => formats.id),
    eventAt: integer('event_at').notNull(),
    rBefore: real('r_before').notNull(),
    rdBefore: real('rd_before').notNull(),
    rAfter: real('r_after').notNull(),
    rdAfter: real('rd_after').notNull(),
    sigmaAfter: real('sigma_after').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.battleId, t.userId] }),
    index('rating_history_user_idx').on(t.userId, t.formatId, t.eventAt),
  ],
);

/** Exceptional cases that need a full recalculation (docs/architecture.md section 3). */
export const replayRequests = sqliteTable(
  'replay_requests',
  {
    id: text('id').primaryKey(),
    /** NULL = all formats. */
    formatId: text('format_id').references(() => formats.id),
    fromEventAt: integer('from_event_at'),
    reason: text('reason').notNull(),
    requestedBy: text('requested_by').references(() => users.id),
    createdAt: integer('created_at').notNull(),
    doneAt: integer('done_at'),
  },
  (t) => [index('replay_requests_open_idx').on(t.doneAt)],
);

// ---------------------------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------------------------

/**
 * Reports about a battle, a video or a profile (concept section 11). Handled by the federation
 * and admins; closing one is audited.
 */
export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id),
    targetType: text('target_type', { enum: REPORT_TARGETS }).notNull(),
    targetId: text('target_id').notNull(),
    category: text('category', { enum: REPORT_CATEGORIES }).notNull(),
    text: text('text').notNull(),
    status: text('status', { enum: REPORT_STATUSES }).notNull().default('open'),
    createdAt: integer('created_at').notNull(),
    closedBy: text('closed_by').references(() => users.id),
    closedAt: integer('closed_at'),
    /** What was done; visible to federation and admins only. */
    closeNote: text('close_note'),
  },
  (t) => [
    index('reports_status_idx').on(t.status, t.createdAt),
    index('reports_target_idx').on(t.targetType, t.targetId),
    index('reports_reporter_idx').on(t.reporterId, t.createdAt),
    oneOf('reports_target_type_check', t.targetType, REPORT_TARGETS),
    oneOf('reports_category_check', t.category, REPORT_CATEGORIES),
    oneOf('reports_status_check', t.status, REPORT_STATUSES),
  ],
);

/**
 * A sport-related action requested by an admin that waits for a federation member's approval
 * (concept section 2), e.g. annulling a battle. Approving carries the action out.
 */
export const federationApprovals = sqliteTable(
  'federation_approvals',
  {
    id: text('id').primaryKey(),
    action: text('action', { enum: FEDERATION_APPROVAL_ACTIONS }).notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    payloadJson: text('payload_json'),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: FEDERATION_APPROVAL_STATUSES }).notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    decidedBy: text('decided_by').references(() => users.id),
    decidedAt: integer('decided_at'),
    decisionNote: text('decision_note'),
  },
  (t) => [
    index('federation_approvals_status_idx').on(t.status, t.createdAt),
    index('federation_approvals_target_idx').on(t.targetType, t.targetId),
    oneOf('federation_approvals_action_check', t.action, FEDERATION_APPROVAL_ACTIONS),
    oneOf('federation_approvals_status_check', t.status, FEDERATION_APPROVAL_STATUSES),
  ],
);

// ---------------------------------------------------------------------------------------------
// Push notifications (stage 2)
// ---------------------------------------------------------------------------------------------

/**
 * A device that wants push notifications (Web Push). Only the push service's address is
 * needed: the push itself carries no content, the device fetches it (services/notify.ts).
 */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    endpoint: text('endpoint').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_unique').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
  ],
);

/**
 * What a person should be told (opponent accepted, videos unlocked, review needed, chat
 * message). The device fetches undelivered ones when a push arrives; kept 30 days.
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    battleId: text('battle_id').references(() => battles.id),
    /** Who caused it (e.g. the opponent who accepted or wrote). */
    actorId: text('actor_id').references(() => users.id),
    createdAt: integer('created_at').notNull(),
    deliveredAt: integer('delivered_at'),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.deliveredAt)],
);
