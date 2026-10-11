/** Who is logged in. `useMe()` is cached by TanStack Query and refreshed after login/logout. */
import type { CurrentUser, Role } from '@hfb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.me()).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useSetMe() {
  const queryClient = useQueryClient();
  return (user: CurrentUser | null) => {
    // Drop cached data of the previous user, but keep the 'me' query itself: mounted pages
    // observe it, and replacing it (e.g. with clear()) would leave them showing stale data.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    queryClient.setQueryData(['me'], user);
  };
}

export function hasRole(user: CurrentUser | null | undefined, ...roles: Role[]): boolean {
  return !!user && user.status === 'active' && roles.some((r) => user.roles.includes(r));
}
