import { z } from "zod";
import { operatorTierSchema } from "../enums";
import { type Permission } from "../permissions";
import { zMinorOut } from "../money";

// ---- requests ----------------------------------------------------------------

export const operatorLoginSchema = z.object({
  identifier: z.string().min(1), // email or username
  password: z.string().min(1),
  totp: z.string().min(6).max(8).optional(),
});
export type OperatorLoginInput = z.infer<typeof operatorLoginSchema>;

export const playerLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type PlayerLoginInput = z.infer<typeof playerLoginSchema>;

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

export const mfaConfirmSchema = z.object({
  totp: z.string().min(6).max(8),
});
export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;

// ---- responses ---------------------------------------------------------------

export const accessTokenResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
});
export type AccessTokenResponse = z.infer<typeof accessTokenResponseSchema>;

export const operatorSummarySchema = z.object({
  userId: z.string(),
  operatorId: z.string(),
  username: z.string(),
  displayName: z.string(),
  tier: operatorTierSchema,
  path: z.string(),
  depth: z.number().int(),
  mfaEnabled: z.boolean(),
  permissions: z.array(z.string()),
});
export type OperatorSummary = z.infer<typeof operatorSummarySchema> & {
  permissions: Permission[];
};

export const walletBalanceSchema = z.object({
  currency: z.enum(["CREDIT", "PLAY", "PRIZE"]),
  balanceMinor: zMinorOut,
});

export const playerSummarySchema = z.object({
  playerId: z.string(),
  operatorId: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  status: z.string(),
  wallets: z.array(walletBalanceSchema),
});
export type PlayerSummary = z.infer<typeof playerSummarySchema>;

export const operatorLoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  operator: operatorSummarySchema,
  mfaRequired: z.boolean().optional(),
});

export const playerLoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  player: playerSummarySchema,
});

export const mfaEnableResponseSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
});
