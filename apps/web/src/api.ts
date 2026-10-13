/**
 * Small typed client for the API. Every call returns the parsed JSON or throws an ApiError
 * with the stable error code from the server (see apps/api/src/lib/errors.ts).
 */
import type {
  BattleSettings,
  CreateCompetition,
  CreateEstimate,
  CreateGroupBattle,
  CreateOnsiteBattle,
  CreateReport,
  CreateVideo,
  CurrentUser,
  GuestAttempt,
  GuestVideo,
  NotificationSettings,
  ReportCategory,
  ReportTarget,
  ReserveAttempts,
  SpecialRole,
  UploadTarget,
} from '@hfb/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

/**
 * Offline copies of a few answers, so a battle can be opened and recorded at the line without a
 * connection (concept section 6). Only on this device; removed at logout.
 */
const OFFLINE_PREFIX = 'hfb-offline:';
const OFFLINE_PATHS = [/^\/auth\/me$/, /^\/formats$/, /^\/battles\/mine$/, /^\/battles\/[\w-]+$/];

function readOffline(path: string): unknown {
  try {
    const stored = localStorage.getItem(OFFLINE_PREFIX + path);
    return stored ? JSON.parse(stored) : undefined;
  } catch {
    return undefined;
  }
}

function writeOffline(path: string, data: unknown) {
  if (!OFFLINE_PATHS.some((p) => p.test(path))) return;
  try {
    localStorage.setItem(OFFLINE_PREFIX + path, JSON.stringify(data));
  } catch {
    // Storage full or blocked: works online anyway.
  }
}

export function clearOfflineCopies() {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(OFFLINE_PREFIX)) localStorage.removeItem(key);
  } catch {
    // Nothing stored.
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // No connection: fall back to the last copy, if any.
    const copy = method === 'GET' ? readOffline(path) : undefined;
    if (copy !== undefined) return copy as T;
    throw new ApiError(0, 'offline', String(error));
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'unknown_error', data.details);
  if (method === 'GET') writeOffline(path, data);
  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);

// ---------------------------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------------------------

export interface Format {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: 'relevant' | 'fun';
  version: number | null;
  parts: { kind: string; count?: number; label?: string }[];
}

export interface FormatProposal extends Format {
  state: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  createdAt: number;
  proposedBy: { username: string | null; displayName: string | null };
}

export interface RatingView {
  r: number;
  rd: number;
  rankingValue: number;
  provisional: boolean;
  nBattles: number;
  lastEventAt: number | null;
}

export interface Profile {
  user: {
    id: string;
    username: string;
    displayName: string;
    status: string;
    createdAt: number;
    roles: string[];
    approvedBy: UserHit | null;
    /** Federation and admins only: reservations never reported back (lost devices). */
    lostReservations?: number | null;
  };
  ratings: (RatingView & { formatId: string; formatName: string })[];
  battles: {
    id: string;
    formatId: string;
    formatName: string | null;
    status: BattleStatus;
    createdAt: number;
    decidedAt: number | null;
    score: number | null;
    /** Group battles: 1 = best. */
    placement: number | null;
    opponents: { userId: string; username: string; displayName: string }[];
    ratingChange: number | null;
  }[];
}

export interface RankingEntry extends RatingView {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
}

export interface Participant {
  userId: string;
  username: string;
  displayName: string;
  seat: number;
  score: number | null;
  /** Group battles: 1 = best. */
  placement?: number | null;
  extraAttempts?: number;
  rating?: RatingView | null;
  /** Reservations for offline recording never reported back (lost devices). */
  lostReservations?: number;
}

export type BattleStatus =
  | 'open'
  | 'negotiating'
  | 'active'
  | 'reviewing'
  | 'decided'
  | 'cancelled'
  | 'annulled';

export interface Proposal {
  id: string;
  kind: 'settings' | 'extension' | 'cancel' | 'extra_attempt' | 'result';
  payload: {
    changes?: Partial<BattleSettings>;
    deadlineAt?: number;
    /** extra_attempt: -1 = take back, +1 = request for oneself (with an optional video). */
    change?: number;
    userId?: string;
    videoId?: string;
    /** result (on-site): 5-point value seen from the proposer, +2 … −2. */
    value?: number;
    /** result of a group battle: everyone's placement (1 = best). */
    placements?: { userId: string; placement: number }[];
  };
  proposedBy: string;
  createdAt: number;
  acceptedBy: string[];
}

export interface Battle {
  id: string;
  formatId: string;
  /** single = two people; group = 3+ people on site; placement = final placement of a competition. */
  kind: 'single' | 'group' | 'placement';
  /** Result of an official competition (counts once the competition is confirmed). */
  competitionId: string | null;
  mode: 'online' | 'onsite';
  status: BattleStatus;
  /** Online: when the videos unlocked; on-site: when the battle took place. */
  playedAt: number | null;
  settings: BattleSettings;
  settingsFlexible: boolean;
  invitedUserId: string | null;
  createdBy: string;
  createdAt: number;
  deadlineAt: number | null;
  deadlinePassed: boolean;
  /** Uploading and choosing stay possible until then (7 days after the deadline). */
  graceUntil?: number | null;
  decisionReason: string | null;
  cancelReason: string | null;
  /** Annulled (with the reason), or a request to annul waiting for the federation. */
  annulment:
    | { state: 'annulled'; at: number | null; reason: string | null; ratingsPending: boolean }
    | { state: 'pending'; at: number; reason: string }
    | null;
  participants: Participant[];
  proposals: Proposal[];
  videos: BattleVideos;
  /** Review while reviewing (and after a decision by review), concept section 7. */
  review: {
    /** 1 = the two athletes, 2 = athlete pool, 3 = judge. */
    level: number;
    levelSince: number | null;
    endsAt: number | null;
    /** Who has voted (level 1). */
    voted: string[];
    /** Level 1 votes seen from seat 0; others' votes only once everyone has voted. */
    votes: { userId: string; value: number }[];
    /** A participant may hand the dispute to the pool now. */
    canEscalate: boolean;
    poolSize: number;
    poolCount: number;
    /** Pool reviews (values), for the judge only. */
    poolVotes: number[] | null;
    myPoolVote: number | null;
    judged: boolean;
    /** What the viewer does in this review: pool reviewer, judge, or nothing. */
    reviewerRole: 'pool' | 'judge' | null;
  } | null;
  /** Rating before and after, for decided battles. */
  ratingChanges: { userId: string; before: number; after: number }[];
}

export interface MyVideo {
  id: string;
  status: 'pending_upload' | 'uploaded' | 'processing' | 'ready' | 'deleted';
  quality: string;
  durationMs: number | null;
  endReason: string | null;
  visibility: string;
  retention: string;
  uploadedAt: number | null;
  /** This is the attempt that counts for its part. */
  counts: boolean;
}

export interface BattleVideos {
  /** Everyone has chosen: the videos that count can be watched. */
  unlocked: boolean;
  /** Per person and part: attempts recorded/uploaded, chosen or not, and the video once unlocked. */
  slots: {
    userId: string;
    partIndex: number;
    round: number;
    attempts: number;
    /** Beyond the allowance: cannot be chosen until extra attempts are granted. */
    provisional: number;
    uploaded: number;
    submittedAt: number | null;
    videoId: string | null;
  }[];
  /** My own attempts as the server knows them. */
  mine: {
    id: string;
    partIndex: number;
    round: number;
    startedAt: number;
    /** Beyond the allowance: cannot be chosen until extra attempts are granted. */
    provisional: boolean;
    /** Inside a reservation's units (recorded offline on the reserving device). */
    reservationId?: string | null;
    /** Filmed by a friend with my athlete code (null = by me). */
    friend: FriendFilmed | null;
    video: MyVideo | null;
  }[];
  /** Cut-off videos the opponent attached to a request for an extra attempt. */
  sharedWithMe: { id: string; ownerId: string; partIndex: number; round: number }[];
  /** Attempts friends filmed for the others (who and when). */
  byFriends: {
    id: string;
    userId: string;
    partIndex: number;
    startedAt: number;
    friend: FriendFilmed;
  }[];
  /** Attempts reserved for offline recording (concept section 6), oldest first. */
  reservations: BattleReservation[];
  /** My free attempts per part (null = unlimited), as the server counts them. */
  free?: (number | null)[];
}

export interface BattleReservation {
  id: string;
  userId: string;
  partIndex: number;
  round: number;
  /** Units that use up the allowance (0 = nothing was free: attempts provisional). */
  count: number;
  requested: number;
  /** Attempts recorded under it so far (as far as the server knows). */
  used: number;
  takeover: boolean;
  createdAt: number;
  reportedAt: number | null;
  /** Handed back: unused units are free again. */
  closedAt: number | null;
  friend: FriendFilmed | null;
  /** Only for my own reservations. */
  deviceCode: string | null;
  deviceLabel: string;
}

/** Filming by friends (concept section 6): the name the friend gave, if any. */
export interface FriendFilmed {
  name: string | null;
}

/** One of an athlete's battles a friend can film for (POST /guest/lookup). */
export interface GuestBattle {
  id: string;
  formatName: string;
  parts: Format['parts'];
  opponents: string[];
  deadlineAt: number | null;
  attemptsPerVideo: number | null;
  /** Open reservations of devices (for the take-over warning). */
  reservations: { partIndex: number; count: number; createdAt: number }[];
  /** Per part; null = unlimited. */
  attemptsLeft: (number | null)[];
}

/** A friend's reservation (POST /guest/reservations). */
export interface GuestReservation {
  id: string;
  battleId: string;
  partIndex: number;
  round: number;
  count: number;
  requested: number;
  takeover: boolean;
  createdAt: number;
  closedAt: number | null;
}

export type BattleSummary = Omit<
  Battle,
  | 'settingsFlexible'
  | 'proposals'
  | 'cancelReason'
  | 'videos'
  | 'review'
  | 'ratingChanges'
  | 'playedAt'
> & {
  unreadMessages: number;
  /** My rating change through this battle (decided battles), else null. */
  ratingChange: number | null;
  /** What is left for me to do (see nextStep.ts). */
  todo: import('./nextStep').Todo;
};

export interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: number;
  /** Set for entries the app writes itself (proposals, answers, extra attempts, …). */
  event?: {
    type: string;
    kind?: string;
    choice?: string;
    payload?: Proposal['payload'];
    /** official_confirmed: who confirmed (not a participant). */
    name?: string;
    /** reserved / reservation_reported (offline recording). */
    partIndex?: number;
    count?: number;
    requested?: number;
    takeover?: boolean;
    friend?: string | null;
    used?: number;
    handedBack?: number;
    closed?: boolean;
  } | null;
}

export interface OpenRequest {
  id: string;
  formatId: string;
  settings: BattleSettings;
  settingsFlexible: boolean;
  direct: boolean;
  createdAt: number;
  challenger: {
    userId: string;
    username: string;
    displayName: string;
    rating: { r: number; rd: number; nBattles: number } | null;
  };
}

export interface UserHit {
  id: string;
  username: string;
  displayName: string;
}

export interface StaffEntry {
  userId: string;
  username: string;
  displayName: string;
  role: SpecialRole;
  grantedAt: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: UserHit | null;
  targetType: string;
  targetId: string | null;
  targetUser: UserHit | null;
  reason: string | null;
  payload: unknown;
  federationApprovalBy: UserHit | null;
  createdAt: number;
}

export interface MyReport {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  category: ReportCategory;
  text: string;
  status: 'open' | 'closed';
  createdAt: number;
  closedAt: number | null;
}

export interface ReportEntry extends MyReport {
  battleId: string | null;
  involved: UserHit[];
  reporter: UserHit | null;
  closedBy: UserHit | null;
  closeNote: string | null;
  canHandle: boolean;
}

export interface FederationApproval {
  id: string;
  action: 'battle.annul';
  targetType: string;
  targetId: string;
  reason: string;
  createdAt: number;
  requestedBy: UserHit;
  canDecide: boolean;
  canWithdraw: boolean;
}

export interface EstimateEntry {
  id: string;
  formatId: string;
  kind: 'athlete' | 'federation' | 'admin';
  value: number;
  createdAt: number;
  estimator?: UserHit;
}

export interface OpenReview {
  battleId: string;
  formatId: string;
  level: number;
  since: number | null;
  participants: { userId: string; displayName: string }[];
}

export type CompetitionStatus = 'planned' | 'running' | 'finished' | 'confirmed' | 'cancelled';

export interface CompetitionSummary {
  id: string;
  name: string;
  location: string | null;
  startsAt: number | null;
  level: number;
  status: CompetitionStatus;
  organizer: UserHit;
}

export interface CompetitionDetail {
  competition: CompetitionSummary & {
    description: string | null;
    organizerId: string;
    confirmedBy: UserHit | null;
    confirmedAt: number | null;
  };
  results: {
    battleId: string;
    formatId: string;
    kind: 'single' | 'placement';
    scoring: string;
    status: BattleStatus;
    cancelReason: string | null;
    participants: {
      userId: string;
      displayName: string;
      seat: number;
      score: number | null;
      placement: number | null;
    }[];
  }[];
  canEdit: boolean;
  canConfirm: boolean;
}

export interface CombinedRanking {
  official: boolean;
  dropWorst: number;
  formats: { id: string; name: string }[];
  ranking: {
    rank: number;
    userId: string;
    username: string;
    displayName: string;
    /** Mean of the kept z-values. */
    value: number;
    /** z per format in the order of `formats`; null = never played. */
    z: (number | null)[];
    formatsPlayed: number;
  }[];
}

export interface PendingUser extends UserHit {
  createdAt: number;
  questionnaire: { freestyleSince?: string; community?: string; note?: string } | null;
}

// ---------------------------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------------------------

type UserResponse = { user: CurrentUser };
type BattleResponse = { battle: Battle };

export const api = {
  me: () => get<UserResponse>('/auth/me'),
  login: (body: { username: string; password: string }) => post<UserResponse>('/auth/login', body),
  register: (body: unknown) => post<UserResponse>('/auth/register', body),
  logout: () => post<{ ok: true }>('/auth/logout'),
  acceptTerms: (version: string) => post<UserResponse>('/auth/accept-terms', { version }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    post('/auth/password', body),
  resetPassword: (body: { code: string; newPassword: string }) =>
    post('/auth/reset-password', body),
  deleteAccount: (body: { password: string; keepVideos: boolean }) =>
    post<{ deletionToken: string }>('/auth/delete-account', body),
  deletionRequest: (token: string) => post<{ ok: true }>('/auth/deletion-request', { token }),
  requestReplay: (reason: string) => post<{ id: string }>('/rulesets/replay', { reason }),

  formats: () => get<{ formats: Format[] }>('/formats'),
  currentRuleset: () =>
    get<{ version: number; params: { weights: Record<string, number> } }>('/rulesets/current'),
  createFormat: (body: unknown) => post<{ format: Format }>('/formats', body),
  formatProposals: () => get<{ proposals: FormatProposal[] }>('/formats/proposals'),
  proposeFormat: (body: unknown) => post('/formats/proposals', body),
  approveFormat: (id: string, body: { status: 'relevant' | 'fun' }) =>
    post(`/formats/${id}/approve`, body),
  rejectFormat: (id: string, body: { note: string }) => post(`/formats/${id}/reject`, body),

  profile: (id: string) => get<Profile>(`/users/${id}`),
  ranking: (formatId: string) =>
    get<{ format: { id: string; name: string }; ranking: RankingEntry[] }>(
      `/formats/${formatId}/ranking`,
    ),
  searchUsers: (q: string) => get<{ users: UserHit[] }>(`/users/search?q=${encodeURIComponent(q)}`),
  pendingUsers: () => get<{ users: PendingUser[] }>('/users/pending'),
  approveUser: (id: string) => post(`/users/${id}/approve`),
  staff: () => get<{ staff: StaffEntry[] }>('/users/staff'),
  grantRole: (id: string, role: SpecialRole, reason?: string) =>
    post(`/users/${id}/roles`, { role, reason }),
  revokeRole: (id: string, role: SpecialRole, reason?: string) =>
    post(`/users/${id}/roles/revoke`, { role, reason }),
  auditLog: (before?: string) =>
    get<{ entries: AuditEntry[]; next: string | null }>(
      before ? `/audit?before=${encodeURIComponent(before)}` : '/audit',
    ),
  createReport: (body: CreateReport) => post<{ id: string }>('/reports', body),
  myReports: () => get<{ reports: MyReport[] }>('/reports/mine'),
  reports: (status: 'open' | 'closed') =>
    get<{ reports: ReportEntry[] }>(`/reports?status=${status}`),
  openReportCount: () => get<{ count: number }>('/reports/open-count'),
  closeReport: (id: string, note: string) => post(`/reports/${id}/close`, { note }),
  annulBattle: (id: string, reason: string) =>
    post<{ status: 'annulled' | 'pending_approval' }>(`/battles/${id}/annul`, { reason }),
  federationApprovals: () => get<{ approvals: FederationApproval[] }>('/federation-approvals'),
  decideApproval: (id: string, decision: 'approve' | 'reject', note?: string) =>
    post(`/federation-approvals/${id}/decide`, { decision, note }),
  withdrawApproval: (id: string) => post(`/federation-approvals/${id}/withdraw`),
  estimates: (subjectId: string) =>
    get<{ mine: EstimateEntry[]; count: number; all: EstimateEntry[] | null }>(
      `/estimates?subjectId=${encodeURIComponent(subjectId)}`,
    ),
  createEstimate: (body: CreateEstimate) =>
    post<{ id: string; replay: boolean }>('/estimates', body),
  withdrawEstimate: (id: string) => post(`/estimates/${id}/withdraw`),
  openReviews: () => get<{ reviews: OpenReview[] }>('/reviews/open'),
  competitions: () => get<{ competitions: CompetitionSummary[] }>('/competitions'),
  competition: (id: string) => get<CompetitionDetail>(`/competitions/${id}`),
  createCompetition: (body: CreateCompetition) => post<{ id: string }>('/competitions', body),
  competitionAction: (id: string, action: string, body?: unknown) =>
    post(`/competitions/${id}/${action}`, body),
  combinedRanking: (choice?: { formats: string[]; drop: number }) =>
    get<CombinedRanking>(
      choice
        ? `/rankings/combined?formats=${choice.formats.map(encodeURIComponent).join(',')}&drop=${choice.drop}`
        : '/rankings/combined',
    ),
  pushKey: () => get<{ publicKey: string | null }>('/push/key'),
  pushSubscribe: (endpoint: string) => post('/push/subscribe', { endpoint }),
  pushUnsubscribe: (endpoint: string) => post('/push/unsubscribe', { endpoint }),
  pushTest: (endpoint: string) =>
    post<{ outcome: 'sent' | 'gone' | 'failed'; status: number; detail?: string }>('/push/test', {
      endpoint,
    }),
  pushSettings: () => get<NotificationSettings>('/push/settings'),
  savePushSettings: (body: NotificationSettings) =>
    put<NotificationSettings>('/push/settings', body),
  createResetCode: (id: string) =>
    post<{ code: string; expiresAt: number }>(`/users/${id}/password-reset-code`),

  myBattles: () => get<{ battles: BattleSummary[] }>('/battles/mine'),
  openRequests: () => get<{ requests: OpenRequest[] }>('/battles/open'),
  battle: (id: string) => get<BattleResponse>(`/battles/${id}`),
  createBattle: (body: unknown) => post<BattleResponse>('/battles', body),
  createOnsiteBattle: (body: CreateOnsiteBattle) => post<BattleResponse>('/battles/onsite', body),
  createGroupBattle: (body: CreateGroupBattle) =>
    post<BattleResponse>('/battles/onsite-group', body),
  messages: (battleId: string) => get<{ messages: Message[] }>(`/battles/${battleId}/messages`),
  sendMessage: (battleId: string, body: string) =>
    post<{ message: Message }>(`/battles/${battleId}/messages`, { body }),
  battleAction: (id: string, action: string, body?: unknown) =>
    post<BattleResponse>(`/battles/${id}/${action}`, body),

  registerAttempt: (
    battleId: string,
    body: {
      id: string;
      partIndex: number;
      round: number;
      startedAt: number;
      deviceCode?: string;
      reservationId?: string;
    },
  ) => post<BattleResponse>(`/battles/${battleId}/attempts`, body),
  discardAttempt: (battleId: string, attemptId: string) =>
    post<BattleResponse>(`/battles/${battleId}/attempts/${attemptId}/discard`),
  reserveAttempts: (battleId: string, body: ReserveAttempts) =>
    post<BattleResponse>(`/battles/${battleId}/reservations`, body),
  reportReservation: (
    battleId: string,
    id: string,
    body: { deviceCode: string; handBack: boolean },
  ) => post<BattleResponse>(`/battles/${battleId}/reservations/${id}/report`, body),
  createVideo: (body: CreateVideo) =>
    post<{ video: { id: string; status: string }; upload: UploadTarget }>('/videos', body),
  completeVideo: (id: string) =>
    post<{ video: { id: string; status: string } }>(`/videos/${id}/complete`),
  videoSettings: (id: string, body: { visibility: string; retention: string }) =>
    post(`/videos/${id}/settings`, body),

  // Filming by friends: my code.
  athleteCode: () => get<{ code: string }>('/athlete-code'),
  chooseAthleteCode: (code: string) => put<{ code: string }>('/athlete-code', { code }),
  renewAthleteCode: () => post<{ code: string }>('/athlete-code/renew'),

  // Filming for a friend with their code (no login needed).
  guestLookup: (code: string) =>
    post<{ athlete: { displayName: string }; battles: GuestBattle[] }>('/guest/lookup', { code }),
  guestAttempt: (body: GuestAttempt) => post<{ battleId: string | null }>('/guest/attempts', body),
  guestReserve: (
    body: ReserveAttempts & { code: string; battleId: string; recorderName?: string },
  ) => post<{ reservations: GuestReservation[] }>('/guest/reservations', body),
  guestDiscard: (attemptId: string, code: string) =>
    post<{ ok: boolean }>(`/guest/attempts/${attemptId}/discard`, { code }),
  guestReport: (id: string, body: { code: string; deviceCode: string; handBack: boolean }) =>
    post<{ reservation: GuestReservation }>(`/guest/reservations/${id}/report`, body),
  guestVideo: (body: GuestVideo) =>
    post<{ video: { id: string; status: string }; upload: UploadTarget }>('/guest/videos', body),
  guestCompleteVideo: (id: string, code: string) =>
    post<{ video: { id: string; status: string } }>(`/guest/videos/${id}/complete`, { code }),
};

/** Address of a video for <video src>; the server checks who may watch it. */
export const videoFileUrl = (id: string) => `/api/videos/${id}/file`;
