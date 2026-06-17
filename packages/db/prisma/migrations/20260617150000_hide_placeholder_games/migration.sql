-- Remove the placeholder catalog games from player view.
--
-- reef-rumble / golden-depths / lumen-keno had no real engine (config {} → the
-- RTP-honouring placeholder). The lobby and the play page both gate on status = ACTIVE,
-- so setting them HIDDEN removes them everywhere while preserving their rows + any
-- historical sessions/rounds (no destructive delete). Idempotent.
UPDATE "games"
SET "status" = 'HIDDEN'::"GameStatus", "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('reef-rumble', 'golden-depths', 'lumen-keno')
  AND "status" <> 'HIDDEN'::"GameStatus";
