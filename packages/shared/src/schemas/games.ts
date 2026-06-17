import { z } from "zod";
import { currencySchema, gameStatusSchema, gameTypeSchema } from "../enums";
import { zMinor, zMinorPositive } from "../money";

export const createGameSchema = z.object({
  code: z.string().min(2).max(60),
  name: z.string().min(1).max(120),
  type: gameTypeSchema,
  rtpBps: z.number().int().min(1).max(10_000),
  minBetMinor: zMinorPositive,
  maxBetMinor: zMinorPositive,
  supportedCurrencies: z.array(currencySchema).min(1),
  thumbnailUrl: z.string().url().optional(),
  config: z.record(z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateGameInput = z.infer<typeof createGameSchema>;

export const updateGameSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  rtpBps: z.number().int().min(1).max(10_000).optional(),
  minBetMinor: zMinor.optional(),
  maxBetMinor: zMinor.optional(),
  supportedCurrencies: z.array(currencySchema).min(1).optional(),
  thumbnailUrl: z.string().url().optional(),
  config: z.record(z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateGameInput = z.infer<typeof updateGameSchema>;

export const setGameStatusSchema = z.object({
  status: gameStatusSchema,
});
export type SetGameStatusInput = z.infer<typeof setGameStatusSchema>;

export const startSessionSchema = z.object({
  gameCode: z.string().min(1),
  currency: currencySchema,
  clientSeed: z.string().max(120).optional(),
});
export type StartSessionInput = z.infer<typeof startSessionSchema>;

export const placeBetSchema = z.object({
  betMinor: zMinorPositive,
  // Optional game-specific bet parameters (e.g. Fortune Wheel risk, Plinko rows). Each
  // engine validates/sanitizes what it needs; unknown games ignore it.
  params: z.record(z.string(), z.unknown()).optional(),
});
export type PlaceBetInput = z.infer<typeof placeBetSchema>;
