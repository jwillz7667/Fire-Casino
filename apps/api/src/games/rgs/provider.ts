import { type Currency, type GameType } from "@aureus/shared";

/** A single round request handed to the game server (docs/05 §10). */
export interface RoundRequest {
  sessionId: string;
  gameCode: string;
  gameType: GameType;
  rtpBps: number;
  betMinor: bigint;
  currency: Currency;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  config: Record<string, unknown>;
  /** Per-bet, game-specific parameters (e.g. wheel risk, plinko rows). Defaults to {}.
   *  Engines read only what they need; the round persists these so retries are stable. */
  params: Record<string, unknown>;
}

/** The outcome the server decides. The client never computes a win. */
export interface RoundResult {
  winMinor: bigint;
  outcome: Record<string, unknown>;
}

/**
 * The game-server contract. The placeholder honors RTP; a real game (server math
 * or a remote RGS) drops in behind this same interface with no change to the
 * money/ledger/seed flow.
 */
export interface GameProvider {
  play(req: RoundRequest): RoundResult;
}

export const GAME_PROVIDER = Symbol("GAME_PROVIDER");
