import { MINOR } from "@aureus/shared";

/**
 * Minimum redemption amount surfaced to the player. The server enforces the
 * authoritative threshold (docs/03 §4.5); this is a sensible client-side floor
 * for the UI when no per-operator minimum is provided.
 */
export const MIN_REDEEM_MINOR = 10n * MINOR;
