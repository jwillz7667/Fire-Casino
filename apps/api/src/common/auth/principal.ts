import { type OperatorTier } from "@aureus/shared";

/** The authenticated operator behind a console request. */
export interface OperatorPrincipal {
  kind: "operator";
  userId: string;
  operatorId: string;
  username: string;
  displayName: string;
  tier: OperatorTier;
  path: string;
  depth: number;
  mfaEnabled: boolean;
  settings: { permissions?: string[] } & Record<string, unknown>;
  sessionId: string;
}

/** The authenticated player behind an arcade request. */
export interface PlayerPrincipal {
  kind: "player";
  playerId: string;
  operatorId: string;
  operatorPath: string;
  username: string;
  sessionId: string;
}

export type Principal = OperatorPrincipal | PlayerPrincipal;

export type Audience = "operator" | "player";

/** Express request augmented with the resolved principal. */
export interface RequestWithPrincipal {
  principal?: Principal;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  ip?: string;
}
