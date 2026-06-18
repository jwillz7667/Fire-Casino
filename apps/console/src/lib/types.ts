// Frontend-facing response shapes. The API serializes BigInt money fields to
// integer strings (zMinorOut / the BigInt toJSON safety net), so every *Minor
// field below is a string and is handed straight to <Money> — never parsed.
import type {
  AmlSeverity,
  AmlStatus,
  CreditOrderStatus,
  Currency,
  GeoAction,
  KycStatus,
  OperatorStatus,
  OperatorTier,
  PlayerStatus,
  PromoStatus,
  RedemptionStatus,
  RgLimitType,
  RgPeriod,
} from "@aureus/shared";

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface BalanceEntry {
  currency: Currency;
  balanceMinor: string;
}

// ---- operators ---------------------------------------------------------------

export interface OperatorNode {
  id: string;
  tier: OperatorTier;
  displayName: string;
  status: OperatorStatus;
  path: string;
  depth: number;
  parentId: string | null;
  buyUnitPriceCents: number | null;
  sellUnitPriceCents: number | null;
  createdAt: string;
  /** Per-operator permission grants (only present on GET /operators/:id). */
  grants?: string[];
}

export interface OperatorTreeNode extends OperatorNode {
  children: OperatorTreeNode[];
}

export interface CreateOperatorResult {
  operator: OperatorNode;
  username: string;
}

export interface OperatorStats {
  operatorCount: number;
  activePlayers: number;
  circulationBelowMinor: string;
}

export interface SetGrantsResult extends OperatorNode {
  permissions: string[];
}

// ---- players -----------------------------------------------------------------

export interface PlayerRow {
  id: string;
  operatorId: string;
  username: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  status: PlayerStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PlayerListItem {
  id: string;
  operatorId: string;
  owningAgentName: string;
  username: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  status: PlayerStatus;
  lastLoginAt: string | null;
  createdAt: string;
  wallets: BalanceEntry[];
  lifetimeRechargedMinor: string;
  lifetimeRedeemedMinor: string;
}

export interface PlayerDetail extends PlayerRow {
  kyc: { status: KycStatus; level: number } | null;
  wallets: BalanceEntry[];
}

export type PlayerHistoryEvent =
  | {
      kind: "ledger";
      id: string;
      at: string;
      type: string;
      direction: "DEBIT" | "CREDIT";
      currency: Currency;
      amountMinor: string;
      balanceAfterMinor: string;
      memo: string | null;
    }
  | {
      kind: "session";
      id: string;
      at: string;
      status: string;
      currency: Currency;
      totalBetMinor: string;
      totalWinMinor: string;
    }
  | {
      kind: "redemption";
      id: string;
      at: string;
      status: RedemptionStatus;
      currency: Currency;
      amountMinor: string;
      method: string | null;
    };

// ---- credit orders -----------------------------------------------------------

export interface CreditOrder {
  id: string;
  buyerOperatorId: string;
  sellerOperatorId: string | null;
  currency: Currency;
  quantityMinor: string;
  unitPriceCents: number;
  totalCents: number;
  status: CreditOrderStatus;
  paymentMethod: string | null;
  paymentRef: string | null;
  proofUrl: string | null;
  note: string | null;
  issuedTxId: string | null;
  requestedByUserId: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  key?: string;
}

export interface LedgerPostResult {
  transactionId: string;
  replayed?: boolean;
}

export interface RechargeResult {
  mode: "OPERATOR" | "COMPLIANCE";
  transactionId?: string;
  prizeBonusMinor: string;
}

export interface RemoveCreditsResult {
  transactionId: string;
  removedMinor: string;
  currency: string;
}

// ---- redemptions -------------------------------------------------------------

export interface RedemptionDto {
  id: string;
  playerId: string;
  operatorId: string;
  currency: Currency;
  amountMinor: string;
  status: RedemptionStatus;
  method: string | null;
  payoutRef: string | null;
  holdTxId: string | null;
  settleTxId: string | null;
  rejectionReason: string | null;
  reviewedByUserId: string | null;
  createdAt: string;
  decidedAt: string | null;
  settledAt: string | null;
}

export interface RedemptionQueueItem extends RedemptionDto {
  playerUsername: string;
  ownerOperatorId: string;
}

export interface PlayerComplianceState {
  playerId: string;
  status: PlayerStatus;
  selfExcluded: boolean;
  selfExclusionUntil: string | null;
  kycStatus: KycStatus;
  kycLevel: number;
  openAmlFlags: number;
  rgLimits: { type: RgLimitType; period: RgPeriod; valueMinor: string | null; minutes: number | null }[];
}

export interface RedemptionDetail extends RedemptionDto {
  playerUsername: string | null;
  ownerOperatorId: string | null;
  compliance: PlayerComplianceState;
}

// ---- compliance --------------------------------------------------------------

export interface KycQueueItem {
  id: string;
  playerId: string;
  playerUsername: string;
  operatorId: string;
  status: KycStatus;
  level: number;
  idType: string;
  documentUrl: string;
  createdAt: string;
}

export interface GeoRule {
  id: string;
  region: string;
  action: GeoAction;
  reason: string | null;
  updatedAt: string;
}

export interface AmlFlag {
  id: string;
  subjectType: string;
  subjectId: string;
  ruleCode: string;
  severity: AmlSeverity;
  status: AmlStatus;
  details: unknown;
  resolvedByUserId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Promotion {
  id: string;
  code: string;
  description: string | null;
  currency: Currency;
  grantMinor: string;
  isAmoe: boolean;
  maxRedemptions: number | null;
  perPlayerLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  status: PromoStatus;
  createdAt: string;
}

// ---- reports (controllers in flight; typed to docs/05 §9 + docs/06 §3.9) -----

export interface ReportsOverview {
  currency: Currency;
  creditsInCirculationMinor: string;
  activePlayers: number;
  netRechargesTodayMinor: string;
  pendingRedemptions: { count: number; totalMinor: string };
  pendingOrders: { inbox: number; outbox: number };
  totalMintedMinor?: string;
  revenueMinor?: string;
}

export interface CreditFlowPoint {
  bucket: string;
  issuedMinor: string;
  transferredMinor: string;
  rechargedMinor: string;
  redeemedMinor: string;
}

export interface CreditFlowReport {
  currency?: Currency;
  granularity?: string;
  from?: string;
  to?: string;
  buckets: CreditFlowPoint[];
}

export interface AgentSalesRow {
  operatorId: string;
  displayName: string;
  tier: string;
  holdingsMinor: string;
  soldToPlayersMinor: string;
  removedFromPlayersMinor: string;
  netToPlayersMinor: string;
}

export interface AgentSalesReport {
  currency: Currency;
  items: AgentSalesRow[];
}

export interface PlayerActivityRow {
  playerId: string;
  username: string;
  operatorId: string;
  rechargedMinor: string;
  redeemedMinor: string;
  netMinor: string;
}
export interface PlayerActivityReport {
  items: PlayerActivityRow[];
}

export interface RevenueReport {
  currency: Currency;
  betsMinor: string;
  winsMinor: string;
  revenueMinor: string;
  platformRevenueMinor?: string;
}

export interface MarginNode {
  operatorId: string;
  displayName: string;
  tier: string;
  buyUnitPriceCents: number;
  sellUnitPriceCents: number;
  spreadCents: number;
  marginCents: number;
}
export interface MarginReport {
  nodes: MarginNode[];
  totalMarginCents: number;
}

export interface SettlementRow {
  id: string;
  operatorId: string;
  counterpartyId: string;
  currency: Currency;
  netCents: number;
  lastEventAt: string;
}
export interface SettlementReport {
  items: SettlementRow[];
  receivableCents: number;
  payableCents: number;
  netCents: number;
}

export interface RedemptionsReport {
  byStatus: { status: string; count: number; totalMinor: string }[];
  pendingMinor: string;
  approvedMinor: string;
  settledMinor: string;
}

export interface ActivityItem {
  id: string;
  type: string;
  actor: string | null;
  currency: Currency;
  amountMinor: string;
  at: string;
}

// Shapes mirror the API exactly (reconciliation.service.ts / reports.service.ledgerHealth).
export interface ReconciliationCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export type ExpectedSign = "negative" | "positive" | "non_negative" | "any";

export interface SystemAccountBalance {
  systemKey: string;
  currency: Currency;
  balanceMinor: string;
  expectedSign: ExpectedSign;
  ok: boolean;
}

export interface LedgerHealth {
  ranAt: string | null;
  checks: ReconciliationCheck[];
  systemAccounts: SystemAccountBalance[];
}

export interface LedgerTxAccount {
  ownerType: "OPERATOR" | "PLAYER" | "SYSTEM";
  operatorId: string | null;
  playerId: string | null;
  systemKey: string | null;
}

export interface LedgerTxLeg {
  id: string;
  account: LedgerTxAccount;
  direction: "DEBIT" | "CREDIT";
  currency: Currency;
  amountMinor: string;
  balanceAfterMinor: string;
}

export interface LedgerTransactionDetail {
  transaction: {
    id: string;
    type: string;
    status: string;
    currency: Currency;
    idempotencyKey: string | null;
    memo: string | null;
    createdAt: string;
  };
  legs: LedgerTxLeg[];
}

// ---- audit -------------------------------------------------------------------

export interface AuditLogRow {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ---- announcements / notifications -------------------------------------------

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: "PLAYERS" | "OPERATORS" | "BOTH";
  operatorScopePath: string | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  audience: "OPERATOR" | "PLAYER";
  userId: string | null;
  playerId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
