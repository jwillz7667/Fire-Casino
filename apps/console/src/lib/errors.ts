import { ApiError } from "./api";

/** Human-friendly copy for the stable error codes (docs/05 §0). */
const CODE_COPY: Record<string, string> = {
  OUT_OF_SCOPE: "That record is outside your part of the tree.",
  INSUFFICIENT_FUNDS: "Not enough balance to complete this.",
  KYC_REQUIRED: "Identity verification is required first.",
  REGION_BLOCKED: "Blocked in this region.",
  SELF_EXCLUDED: "This player is self-excluded.",
  RG_LIMIT_EXCEEDED: "A responsible-gaming limit blocks this.",
  CONFLICT: "This conflicts with the current state — refresh and retry.",
  VALIDATION_ERROR: "Some fields are invalid.",
  UNAUTHORIZED: "Your session expired. Please sign in again.",
  FORBIDDEN: "You don't have permission to do that.",
  RATE_LIMITED: "Too many attempts — slow down a moment.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return CODE_COPY[error.code] ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function errorTitle(error: unknown): string {
  if (error instanceof ApiError && error.code === "IDEMPOTENT_REPLAY") return "Already done";
  return "Action failed";
}
