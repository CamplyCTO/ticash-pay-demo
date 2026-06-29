import { QueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { Me } from '@ticash/api-client';
import { api } from './client';
import { useAuthStore } from './auth-store';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
  },
});

/** Profile + balances for the logged-in user (scoped server-side to their own data). */
export function useMe() {
  const status = useAuthStore((s) => s.status);
  return useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api.me(),
    enabled: status === 'authenticated',
  });
}
