import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentOpInput, Currency, KycLimit, Me, SendTransferInput, TransferPricing, TxRow } from '@ticash/api-client';
import { api } from './client';
import { useAuthStore } from './auth-store';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
  },
});

function useAuthed() {
  return useAuthStore((s) => s.status) === 'authenticated';
}

/** Profile + balances for the logged-in user (scoped server-side to their own data). */
export function useMe() {
  const enabled = useAuthed();
  return useQuery<Me>({ queryKey: ['me'], queryFn: () => api.me(), enabled });
}

/** Live transfer economics for a corridor + amount (debounce the amount in the UI). */
export function useQuote(from: Currency, to: Currency, amount: string) {
  const enabled = useAuthed() && Number(amount) > 0 && from !== to;
  return useQuery<TransferPricing>({
    queryKey: ['quote', from, to, amount],
    queryFn: () => api.priceTransfer(from, to, amount),
    enabled,
    staleTime: 10_000,
  });
}

/** The caller's transaction history. */
export function useTransactions(limit = 50) {
  const enabled = useAuthed();
  return useQuery<TxRow[]>({ queryKey: ['transactions', limit], queryFn: () => api.transactions(limit), enabled });
}

export function useKycLimits() {
  const enabled = useAuthed();
  return useQuery<KycLimit[]>({ queryKey: ['kyc-limits'], queryFn: () => api.kycLimits(), enabled });
}

export function useAirtimeProducts(country: string) {
  const enabled = useAuthed() && country.length === 2;
  return useQuery({ queryKey: ['airtime-products', country], queryFn: () => api.airtimeProducts(country), enabled });
}

/** Send money; on success refresh balances + history. */
export function useSendTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendTransferInput) => api.sendTransfer(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useAirtimeTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { country: string; accountNumber: string; skuCode: string; cost: string }) => api.airtimeTopup(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useKycStart() {
  return useMutation({ mutationFn: () => api.kycStart() });
}

// ---- agent (WS-3) ----
export function useLookupCustomer() {
  return useMutation({ mutationFn: (phone: string) => api.lookupCustomer(phone) });
}

export function useAgentCashIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentOpInput) => api.agentCashIn(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useAgentCashOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentOpInput) => api.agentCashOut(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
