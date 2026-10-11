/**
 * Small typed client for the API. Every call returns the parsed JSON or throws an ApiError
 * with the stable error code from the server (see apps/api/src/lib/errors.ts).
 */
import type {
  BattleSettings,
  CreateOnsiteBattle,
  CreateVideo,
  CurrentUser,
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
  extraAttempts?: number;
  rating?: RatingView | null;
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
  };
  proposedBy: string;
  createdAt: number;
  acceptedBy: string[];
}

export interface Battle {
  id: string;
  formatId: string;
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
  decisionReason: string | null;
  cancelReason: string | null;
  participants: Participant[];
  proposals: Proposal[];
  videos: BattleVideos;
  /** Review level 1 while reviewing (and after a decision by review). */
  review: {
    level: number;
    endsAt: number | null;
    /** Who has voted. */
    voted: string[];
    /** Votes seen from seat 0; others' votes only once everyone has voted. */
    votes: { userId: string; value: number }[];
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
    video: MyVideo | null;
  }[];
  /** Cut-off videos the opponent attached to a request for an extra attempt. */
  sharedWithMe: { id: string; ownerId: string; partIndex: number; round: number }[];
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
  createResetCode: (id: string) =>
    post<{ code: string; expiresAt: number }>(`/users/${id}/password-reset-code`),

  myBattles: () => get<{ battles: BattleSummary[] }>('/battles/mine'),
  openRequests: () => get<{ requests: OpenRequest[] }>('/battles/open'),
  battle: (id: string) => get<BattleResponse>(`/battles/${id}`),
  createBattle: (body: unknown) => post<BattleResponse>('/battles', body),
  createOnsiteBattle: (body: CreateOnsiteBattle) => post<BattleResponse>('/battles/onsite', body),
  messages: (battleId: string) => get<{ messages: Message[] }>(`/battles/${battleId}/messages`),
  sendMessage: (battleId: string, body: string) =>
    post<{ message: Message }>(`/battles/${battleId}/messages`, { body }),
  battleAction: (id: string, action: string, body?: unknown) =>
    post<BattleResponse>(`/battles/${id}/${action}`, body),

  registerAttempt: (
    battleId: string,
    body: { id: string; partIndex: number; round: number; startedAt: number },
  ) => post<BattleResponse>(`/battles/${battleId}/attempts`, body),
  createVideo: (body: CreateVideo) =>
    post<{ video: { id: string; status: string }; upload: UploadTarget }>('/videos', body),
  completeVideo: (id: string) =>
    post<{ video: { id: string; status: string } }>(`/videos/${id}/complete`),
};

/** Address of a video for <video src>; the server checks who may watch it. */
export const videoFileUrl = (id: string) => `/api/videos/${id}/file`;
