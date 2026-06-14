"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "./auth-context";
import { fetchCompliance, fetchWallet, qk } from "./queries";
import type { ComplianceState, WalletResponse } from "./types";

/** Live wallet balances (refetched by the realtime layer on balance.changed). */
export function useWallet(): UseQueryResult<WalletResponse> {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: qk.wallet,
    queryFn: fetchWallet,
    enabled: isAuthenticated,
  });
}

/** Player compliance posture (KYC, RG limits, self-exclusion). */
export function useCompliance(): UseQueryResult<ComplianceState> {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: qk.compliance,
    queryFn: fetchCompliance,
    enabled: isAuthenticated,
    retry: false,
  });
}
