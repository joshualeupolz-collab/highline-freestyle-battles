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

export interface Participant {
  userId: string;
  username: string;
  displayName: string;
  seat: number;
  score: number | null;
  extraAttempts?: number;
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
  kind: 'settings' | 'extension' | 'cancel';
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

export type BattleSummary = Omit<Battle, 'settingsFlexible' | 'proposals' | 'cancelReason'>;

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

  searchUsers: (q: string) => get<{ users: UserHit[] }>(`/users/search?q=${encodeURIComponent(q)}`),
  pendingUsers: () => get<{ users: PendingUser[] }>('/users/pending'),
  approveUser: (id: string) => post(`/users/${id}/approve`),
  createResetCode: (id: string) =>
    post<{ code: string; expiresAt: number }>(`/users/${id}/password-reset-code`),

  myBattles: () => get<{ battles: BattleSummary[] }>('/battles/mine'),
  openRequests: () => get<{ requests: OpenRequest[] }>('/battles/open'),
  battle: (id: string) => get<BattleResponse>(`/battles/${id}`),
  createBattle: (body: unknown) => post<BattleResponse>('/battles', body),
  battleAction: (id: string, action: string, body?: unknown) =>
    post<BattleResponse>(`/battles/${id}/${action}`, body),
};
