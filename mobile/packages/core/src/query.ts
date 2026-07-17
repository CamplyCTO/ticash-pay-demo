import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentOpInput, CashoutRequest, CreateOfferInput, Currency, KycLimit, Me, P2POffer, P2POrder, SendTransferInput, TransferPricing, TxRow } from '@ticash/api-client';
import { api } from './client';
import { useAuthStore } from './auth-store';

export const queryClient = new QueryClient({
  defaultOptions: {
    // Keep data fresh without a re-login: refetch when a screen is navigated to
    // (refetchOnMount) and when the app returns to the foreground (window focus,
    // wired to React Native AppState in the app root via focusManager).
    queries: { retry: 1, staleTime: 3_000, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchOnReconnect: true },
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

export function useDepositPix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { amount: string; payerName: string; payerCpf: string }) => api.depositPix(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
/** USDT on-ramp: get a crypto deposit address (NOWPayments); wallet credits on settlement. */
export function useUsdtDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amount: string) => api.usdtDeposit(amount),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

// ---- Cash-out approval (customer approves an agent-initiated withdrawal) ----
/** Pending cash-out requests awaiting the customer's approval. Polls so a new
 *  request appears even without a push. */
export function useCashoutPending() {
  const enabled = useAuthed();
  return useQuery<CashoutRequest[]>({ queryKey: ['cashout-pending'], queryFn: () => api.cashoutPending(), enabled, refetchInterval: 15_000 });
}
const invalidateCashout = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['cashout-pending'] });
  void qc.invalidateQueries({ queryKey: ['me'] });
  void qc.invalidateQueries({ queryKey: ['transactions'] });
};
export function useApproveCashout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.cashoutApprove(id), onSuccess: () => invalidateCashout(qc) });
}
export function useRejectCashout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.cashoutReject(id), onSuccess: () => invalidateCashout(qc) });
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

// ---- P2P USDT marketplace (WS-4) ----
export function useP2POffers() {
  const enabled = useAuthed();
  return useQuery<P2POffer[]>({ queryKey: ['p2p-offers'], queryFn: () => api.p2pOffers(), enabled });
}
export function useMyP2POffers() {
  const enabled = useAuthed();
  return useQuery<P2POffer[]>({ queryKey: ['p2p-my-offers'], queryFn: () => api.p2pMyOffers(), enabled });
}
export function useP2POrders(role?: 'buyer' | 'seller') {
  const enabled = useAuthed();
  return useQuery<P2POrder[]>({ queryKey: ['p2p-orders', role ?? 'buyer'], queryFn: () => api.p2pMyOrders(role), enabled });
}

const invalidateP2P = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['p2p-offers'] });
  void qc.invalidateQueries({ queryKey: ['p2p-my-offers'] });
  void qc.invalidateQueries({ queryKey: ['p2p-orders'] });
  void qc.invalidateQueries({ queryKey: ['me'] });
};

export function useCreateP2POffer() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateOfferInput) => api.p2pCreateOffer(input), onSuccess: () => invalidateP2P(qc) });
}
export function useCloseP2POffer() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.p2pCloseOffer(id), onSuccess: () => invalidateP2P(qc) });
}
export function useOpenP2POrder() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { offerId: string; amount: string; methodType?: string }) => api.p2pOpenOrder(input), onSuccess: () => invalidateP2P(qc) });
}
export function useP2PPay() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { id: string; proofRef: string }) => api.p2pPay(input.id, input.proofRef), onSuccess: () => invalidateP2P(qc) });
}
export function useReleaseP2POrder() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.p2pRelease(id), onSuccess: () => invalidateP2P(qc) });
}
export function useCancelP2POrder() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.p2pCancel(id), onSuccess: () => invalidateP2P(qc) });
}
export function useDisputeP2POrder() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { id: string; reason: string }) => api.p2pDispute(input.id, input.reason), onSuccess: () => invalidateP2P(qc) });
}
