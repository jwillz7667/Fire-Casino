import type {
  Currency,
  GameStatus,
  GameType,
  KycStatus,
  RgLimitType,
  RgPeriod,
} from "@aureus/shared";

/**
 * Response DTO shapes for the player-surface endpoints the arcade consumes.
 * Money fields arrive as integer strings of minor units (the API serializes
 * BigInt as strings); they are passed straight to <Money> / BigInt() — never
 * parsed with Number().
 */

export interface WalletBalance {
  currency: Currency;
  balanceMinor: string;
}

export interface WalletResponse {
  wallets: WalletBalance[];
}

export interface WalletHistoryItem {
  id: string;
  type: string;
  direction: "DEBIT" | "CREDIT";
  currency: Currency;
  amountMinor: string;
  balanceAfterMinor: string;
  memo: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string;
}

export interface GameDTO {
  id: string;
  code: string;
  name: string;
  type: GameType;
  status: GameStatus;
  rtpBps: number;
  minBetMinor: string;
  maxBetMinor: string;
  supportedCurrencies: Currency[];
  thumbnailUrl: string | null;
  sortOrder: number;
}

export interface StartSessionResponse {
  sessionId: string;
  serverSeedHash: string;
  clientSeed: string | null;
  currency: Currency;
}

export interface RoundDTO {
  id: string;
  nonce: number;
  betMinor: string;
  winMinor: string;
  outcome: Record<string, unknown>;
}

export interface BetResponse {
  round: RoundDTO;
  balanceAfterMinor: string;
}

export interface EndSessionResponse {
  sessionId: string;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string | null;
}

export interface RechargeRequestResponse {
  status: "requested";
}

export interface RedemptionDTO {
  id: string;
  playerId: string;
  operatorId: string;
  currency: Currency;
  amountMinor: string;
  status: string;
  method: string | null;
  payoutRef: string | null;
  rejectionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  settledAt: string | null;
}

export interface RgLimitView {
  type: RgLimitType;
  period: RgPeriod;
  valueMinor: string | null;
  minutes: number | null;
}

/** Mirrors the API's PlayerComplianceState (compliance.service.ts). */
export interface ComplianceState {
  playerId: string;
  status: string;
  selfExcluded: boolean;
  selfExclusionUntil: string | null;
  kycStatus: KycStatus;
  kycLevel: number;
  openAmlFlags: number;
  rgLimits: RgLimitView[];
}

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  fileUrl: string;
}
