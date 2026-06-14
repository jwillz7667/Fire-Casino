import { ApiError } from "./api";

/** Stable error codes the player surface special-cases (docs/05 §0). */
export const ERROR_CODES = {
  OUT_OF_SCOPE: "OUT_OF_SCOPE",
  REGION_BLOCKED: "REGION_BLOCKED",
  KYC_REQUIRED: "KYC_REQUIRED",
  SELF_EXCLUDED: "SELF_EXCLUDED",
  RG_LIMIT_EXCEEDED: "RG_LIMIT_EXCEEDED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
} as const;

const FRIENDLY: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Not enough balance. Load up to keep playing.",
  KYC_REQUIRED: "Verify your identity before you can cash out.",
  REGION_BLOCKED: "Not available in your area.",
  SELF_EXCLUDED: "You've self-excluded. Play and recharge are paused.",
  RG_LIMIT_EXCEEDED: "You've reached a responsible-gaming limit.",
  VALIDATION_ERROR: "Please check the details and try again.",
  CONFLICT: "That can't be completed right now.",
  UNAUTHORIZED: "Please sign in again.",
  FORBIDDEN: "You don't have access to that.",
  OUT_OF_SCOPE: "That's outside your access.",
};

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

export function isErrorCode(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.code === code;
}

export function messageForError(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
