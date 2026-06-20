-- Re-scale every game's bet limits to the new dollar ladder: min $0.05, max $10.00.
-- Money is integer minor units (1 credit = 1000 minor = $1.00), so $0.05 = 50 minor and
-- $10.00 = 10000 minor. The biggest bet allowed anywhere in the casino is now $10.
-- Idempotent: re-running just re-asserts the same limits.
UPDATE "games"
SET "minBetMinor" = 50,
    "maxBetMinor" = 10000,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "minBetMinor" <> 50 OR "maxBetMinor" <> 10000;
