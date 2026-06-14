import { z } from "zod";

/**
 * Domain enums, defined once here as zod enums (with inferred TS types and a
 * value accessor of the same name). These mirror the Prisma schema enums
 * exactly; the literal values must stay in sync with packages/db/prisma/schema.
 * Kept framework-free so the frontends can import them without pulling Prisma.
 *
 * Pattern per enum:
 *   export const fooSchema = z.enum([...]);
 *   export type Foo = z.infer<typeof fooSchema>;   // the union type
 *   export const Foo = fooSchema.enum;             // value accessor: Foo.BAR
 */

export const userStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "LOCKED"]);
export type UserStatus = z.infer<typeof userStatusSchema>;
export const UserStatus = userStatusSchema.enum;

export const tokenAudienceSchema = z.enum(["OPERATOR", "PLAYER"]);
export type TokenAudience = z.infer<typeof tokenAudienceSchema>;
export const TokenAudience = tokenAudienceSchema.enum;

export const operatorTierSchema = z.enum([
  "SUPER_ADMIN",
  "ADMIN",
  "MASTER_DISTRIBUTOR",
  "DISTRIBUTOR",
  "SUB_DISTRIBUTOR",
  "STORE",
]);
export type OperatorTier = z.infer<typeof operatorTierSchema>;
export const OperatorTier = operatorTierSchema.enum;

export const operatorStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]);
export type OperatorStatus = z.infer<typeof operatorStatusSchema>;
export const OperatorStatus = operatorStatusSchema.enum;

export const playerStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "SELF_EXCLUDED", "CLOSED"]);
export type PlayerStatus = z.infer<typeof playerStatusSchema>;
export const PlayerStatus = playerStatusSchema.enum;

export const ledgerOwnerTypeSchema = z.enum(["OPERATOR", "PLAYER", "SYSTEM"]);
export type LedgerOwnerType = z.infer<typeof ledgerOwnerTypeSchema>;
export const LedgerOwnerType = ledgerOwnerTypeSchema.enum;

export const systemAccountSchema = z.enum([
  "MINT",
  "REVENUE",
  "REDEMPTION_CLEARING",
  "PROMO",
  "ADJUSTMENT",
  "ROUNDING",
]);
export type SystemAccount = z.infer<typeof systemAccountSchema>;
export const SystemAccount = systemAccountSchema.enum;

export const currencySchema = z.enum(["CREDIT", "PLAY", "PRIZE"]);
export type Currency = z.infer<typeof currencySchema>;
export const Currency = currencySchema.enum;

export const ledgerTxTypeSchema = z.enum([
  "ISSUE",
  "TRANSFER",
  "RECHARGE",
  "PROMO_GRANT",
  "GAME_BET",
  "GAME_WIN",
  "GAME_ROUND_NET",
  "REDEEM_HOLD",
  "REDEEM_CANCEL",
  "REDEEM_SETTLE",
  "ADJUSTMENT",
  "REVERSAL",
]);
export type LedgerTxType = z.infer<typeof ledgerTxTypeSchema>;
export const LedgerTxType = ledgerTxTypeSchema.enum;

export const ledgerTxStatusSchema = z.enum(["PENDING", "POSTED", "REVERSED", "FAILED"]);
export type LedgerTxStatus = z.infer<typeof ledgerTxStatusSchema>;
export const LedgerTxStatus = ledgerTxStatusSchema.enum;

export const entryDirectionSchema = z.enum(["DEBIT", "CREDIT"]);
export type EntryDirection = z.infer<typeof entryDirectionSchema>;
export const EntryDirection = entryDirectionSchema.enum;

export const creditOrderStatusSchema = z.enum([
  "REQUESTED",
  "AWAITING_PAYMENT",
  "PAID",
  "ISSUED",
  "CANCELLED",
  "REFUNDED",
]);
export type CreditOrderStatus = z.infer<typeof creditOrderStatusSchema>;
export const CreditOrderStatus = creditOrderStatusSchema.enum;

export const gameTypeSchema = z.enum(["FISH", "SLOT", "KENO", "TABLE", "OTHER"]);
export type GameType = z.infer<typeof gameTypeSchema>;
export const GameType = gameTypeSchema.enum;

export const gameStatusSchema = z.enum(["ACTIVE", "HIDDEN", "MAINTENANCE"]);
export type GameStatus = z.infer<typeof gameStatusSchema>;
export const GameStatus = gameStatusSchema.enum;

export const gameSessionStatusSchema = z.enum(["ACTIVE", "ENDED"]);
export type GameSessionStatus = z.infer<typeof gameSessionStatusSchema>;
export const GameSessionStatus = gameSessionStatusSchema.enum;

export const redemptionStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "PAID",
  "REJECTED",
  "CANCELLED",
]);
export type RedemptionStatus = z.infer<typeof redemptionStatusSchema>;
export const RedemptionStatus = redemptionStatusSchema.enum;

export const promoStatusSchema = z.enum(["ACTIVE", "PAUSED", "ENDED"]);
export type PromoStatus = z.infer<typeof promoStatusSchema>;
export const PromoStatus = promoStatusSchema.enum;

export const kycStatusSchema = z.enum(["NONE", "PENDING", "VERIFIED", "REJECTED"]);
export type KycStatus = z.infer<typeof kycStatusSchema>;
export const KycStatus = kycStatusSchema.enum;

export const geoActionSchema = z.enum(["ALLOW", "BLOCK"]);
export type GeoAction = z.infer<typeof geoActionSchema>;
export const GeoAction = geoActionSchema.enum;

export const rgLimitTypeSchema = z.enum(["DEPOSIT", "LOSS", "SESSION_TIME", "WAGER"]);
export type RgLimitType = z.infer<typeof rgLimitTypeSchema>;
export const RgLimitType = rgLimitTypeSchema.enum;

export const rgPeriodSchema = z.enum(["DAILY", "WEEKLY", "MONTHLY", "SESSION"]);
export type RgPeriod = z.infer<typeof rgPeriodSchema>;
export const RgPeriod = rgPeriodSchema.enum;

export const amlSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type AmlSeverity = z.infer<typeof amlSeveritySchema>;
export const AmlSeverity = amlSeveritySchema.enum;

export const amlStatusSchema = z.enum(["OPEN", "REVIEWING", "CLEARED", "ESCALATED"]);
export type AmlStatus = z.infer<typeof amlStatusSchema>;
export const AmlStatus = amlStatusSchema.enum;

export const announcementAudienceSchema = z.enum(["PLAYERS", "OPERATORS", "BOTH"]);
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;
export const AnnouncementAudience = announcementAudienceSchema.enum;

export const outboxStatusSchema = z.enum(["PENDING", "SENT", "FAILED"]);
export type OutboxStatus = z.infer<typeof outboxStatusSchema>;
export const OutboxStatus = outboxStatusSchema.enum;

/**
 * Tier ranking (docs/04 §1). A node may create a child of strictly higher rank
 * (deeper tier); only STORE (rank 5) may own players. Lower number = more
 * powerful / higher in the tree.
 */
export const TIER_RANK: Record<OperatorTier, number> = {
  SUPER_ADMIN: 0,
  ADMIN: 1,
  MASTER_DISTRIBUTOR: 2,
  DISTRIBUTOR: 3,
  SUB_DISTRIBUTOR: 4,
  STORE: 5,
};

/** A node may create a child only if the child's tier ranks strictly below it. */
export function canCreateChildTier(parent: OperatorTier, child: OperatorTier): boolean {
  return TIER_RANK[child] > TIER_RANK[parent];
}

/** Only STORE operators own players (docs/04 §1). */
export function canOwnPlayers(tier: OperatorTier): boolean {
  return tier === OperatorTier.STORE;
}

/** Tiers for which TOTP MFA is mandatory (docs/01 §4). */
export const MFA_REQUIRED_TIERS: OperatorTier[] = [OperatorTier.SUPER_ADMIN, OperatorTier.ADMIN];

/** Whether a tier must have MFA enrolled (docs/01 §4: required for SUPER_ADMIN/ADMIN). */
export function tierRequiresMfa(tier: OperatorTier): boolean {
  return MFA_REQUIRED_TIERS.includes(tier);
}
