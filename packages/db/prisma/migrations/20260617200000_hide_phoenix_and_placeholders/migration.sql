-- Remove Phoenix Ascendant from player view, and re-assert the three placeholder
-- catalog games (reef-rumble / golden-depths / lumen-keno) as HIDDEN.
--
-- This is self-healing: if 20260617150000_hide_placeholder_games never reached a
-- given database (e.g. the API was not redeployed after it landed), this migration
-- still hides those rows. The lobby (GamesService.listCatalog) and the play gate
-- both filter on status = ACTIVE, so HIDDEN removes these everywhere while keeping
-- the rows and any historical sessions/rounds intact. Idempotent.
UPDATE "games"
SET "status" = 'HIDDEN'::"GameStatus", "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('phoenix-ascendant', 'reef-rumble', 'golden-depths', 'lumen-keno')
  AND "status" <> 'HIDDEN'::"GameStatus";
