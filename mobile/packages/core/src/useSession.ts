import { useAuthStore } from './auth-store';

/** Convenience selector for routing/auth gating. */
export function useSession() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  return {
    status,
    user,
    isLoading: status === 'loading',
    isAuthed: status === 'authenticated',
  };
}
