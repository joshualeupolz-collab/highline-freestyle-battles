/**
 * Small typed client for the API. Every call returns the parsed JSON or throws an ApiError
 * with the stable error code from the server (see apps/api/src/lib/errors.ts).
 */
import type { BattleSettings, CurrentUser } from '@hfb/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'unknown_error', data.details);
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
  parts: { kind: string; count: number; label?: string }[];
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
  kind: 'settings' | 'extension' | 'cancel' | 'extra_attempt';
  payload: { changes?: Partial<BattleSettings>; deadlineAt?: number };
  proposedBy: string;
  createdAt: number;
  acceptedBy: string[];
}

export interface Battle {
  id: string;
  formatId: string;
  status: BattleStatus;
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
}

export type BattleSummary = Omit<Battle, 'settingsFlexible' | 'proposals' | 'cancelReason'> & {
  unreadMessages: number;
};

export interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: number;
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
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    post('/auth/password', body),
  resetPassword: (body: { code: string; newPassword: string }) =>
    post('/auth/reset-password', body),

  formats: () => get<{ formats: Format[] }>('/formats'),
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
  createResetCode: (id: string) =>
    post<{ code: string; expiresAt: number }>(`/users/${id}/password-reset-code`),

  myBattles: () => get<{ battles: BattleSummary[] }>('/battles/mine'),
  openRequests: () => get<{ requests: OpenRequest[] }>('/battles/open'),
  battle: (id: string) => get<BattleResponse>(`/battles/${id}`),
  createBattle: (body: unknown) => post<BattleResponse>('/battles', body),
  messages: (battleId: string) => get<{ messages: Message[] }>(`/battles/${battleId}/messages`),
  sendMessage: (battleId: string, body: string) =>
    post<{ message: Message }>(`/battles/${battleId}/messages`, { body }),
  battleAction: (id: string, action: string, body?: unknown) =>
    post<BattleResponse>(`/battles/${id}/${action}`, body),
};
