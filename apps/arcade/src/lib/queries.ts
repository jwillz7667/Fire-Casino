import type { Currency } from "@aureus/shared";
import { api } from "./api";
import type {
  ComplianceState,
  GameDTO,
  Paginated,
  RedemptionDTO,
  WalletHistoryItem,
  WalletResponse,
} from "./types";

/** Query key registry — kept here so socket invalidation and pages agree. */
export const qk = {
  wallet: ["wallet"] as const,
  walletHistory: ["wallet", "history"] as const,
  games: (currency?: Currency) => ["games", currency ?? "all"] as const,
  game: (code: string) => ["game", code] as const,
  redemptions: ["redemptions"] as const,
  compliance: ["compliance", "me"] as const,
};

export function fetchWallet(): Promise<WalletResponse> {
  return api.get<WalletResponse>("/wallet");
}

export function fetchWalletHistory(cursor?: string): Promise<Paginated<WalletHistoryItem>> {
  return api.get<Paginated<WalletHistoryItem>>("/wallet/history", { query: { cursor, limit: 25 } });
}

export function fetchGames(currency?: Currency): Promise<GameDTO[]> {
  return api.get<GameDTO[]>("/games", { query: { currency } });
}

export function fetchGame(code: string): Promise<GameDTO> {
  return api.get<GameDTO>(`/games/${encodeURIComponent(code)}`);
}

export function fetchRedemptions(cursor?: string): Promise<Paginated<RedemptionDTO>> {
  return api.get<Paginated<RedemptionDTO>>("/redemptions", { query: { cursor, limit: 25 } });
}

export function fetchCompliance(): Promise<ComplianceState> {
  return api.get<ComplianceState>("/compliance/me");
}
